import "server-only";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@/generated/control-plane";
import { getControlDb } from "@/lib/control-db";
import { normalizeTenantSlug } from "@/lib/control-plane";
import { hashSecurityIdentifier } from "@/lib/security";
import { sendTransactionalEmail } from "@/lib/transactional-email";

const SIGNUP_TOKEN_TTL_MS = 20 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export const PUBLIC_AUTH_RESPONSE =
  "Si la solicitud es válida, recibirás un correo con los siguientes pasos.";

type SignupIntentInput = {
  name: string;
  email: string;
  password: string;
  displayName: string;
  slug: string;
  timeZone: string;
  idempotencyKey: string;
  fingerprint?: string;
  utm?: Record<string, string>;
  ip: string;
};

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) {
    throw new Error("Ingresa un correo electrónico válido.");
  }
  return email;
}

function validatePassword(value: string) {
  if (value.length < 12 || value.length > 128) {
    throw new Error("La contraseña debe tener entre 12 y 128 caracteres.");
  }
  return value;
}

function cleanName(value: string, field: string, required = true) {
  const clean = value.trim().replace(/\s+/g, " ");
  if (required && !clean) throw new Error(`Completa ${field}.`);
  if (clean.length > 160)
    throw new Error(`${field} no puede exceder 160 caracteres.`);
  return clean || null;
}

function validateTimeZone(value: string) {
  const timeZone = value.trim() || "America/Mexico_City";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new Error("La zona horaria no es válida.");
  }
  return timeZone;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

function publicBaseUrl() {
  const raw =
    process.env.APP_BASE_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim();
  if (!raw)
    throw new Error("La URL pública de la aplicación no está configurada.");
  const url = new URL(raw);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("La URL pública debe usar HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

function safeUtm(value?: Record<string, string>) {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, entry]) =>
          /^utm_(source|medium|campaign|term|content)$/i.test(key) &&
          typeof entry === "string",
      )
      .map(([key, entry]) => [key.toLowerCase(), entry.trim().slice(0, 160)])
      .filter(([, entry]) => entry),
  );
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] || character,
  );
}

function emailHtml(title: string, copy: string, url: string, action: string) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><h1 style="font-size:22px">${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p><p><a href="${escapeHtml(url)}" style="display:inline-block;background:#2563eb;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action)}</a></p><p style="font-size:13px;color:#667085">Si no solicitaste esto, puedes ignorar este correo.</p></body></html>`;
}

async function recordAndSendEmail(input: {
  signupIntentId?: string;
  userId?: string;
  recipientEmail: string;
  template: "signup_verification" | "password_reset";
  subject: string;
  text: string;
  html: string;
}) {
  const db = getControlDb();
  const delivery = await db.emailDelivery.create({
    data: {
      signupIntentId: input.signupIntentId,
      userId: input.userId,
      recipientEmail: input.recipientEmail,
      template: input.template,
      provider: "resend",
    },
    select: { id: true },
  });
  try {
    const sent = await sendTransactionalEmail({
      to: input.recipientEmail,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    await db.emailDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SENT",
        externalId: sent.externalId,
        sentAt: new Date(),
        provider: sent.provider,
      },
    });
  } catch (error) {
    await db.emailDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "FAILED",
        errorCode:
          error instanceof Error
            ? error.message.slice(0, 160)
            : "provider_error",
      },
    });
    throw error;
  }
}

async function sendSignupVerification(
  intent: { id: string; email: string; displayName: string },
  token: string,
) {
  const url = `${publicBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  await recordAndSendEmail({
    signupIntentId: intent.id,
    recipientEmail: intent.email,
    template: "signup_verification",
    subject: "Confirma tu correo para crear tu CRM",
    text: `Hola. Confirma tu correo para terminar de crear ${intent.displayName}: ${url}`,
    html: emailHtml(
      "Confirma tu correo",
      `Confirma tu correo para crear el espacio de ${intent.displayName}. El enlace vence en 20 minutos.`,
      url,
      "Confirmar correo",
    ),
  });
}

export async function createSignupIntent(input: SignupIntentInput) {
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);
  const name = cleanName(input.name, "tu nombre", false);
  const displayName = cleanName(input.displayName, "el nombre del negocio")!;
  const requestedSlug = normalizeTenantSlug(input.slug);
  const timeZone = validateTimeZone(input.timeZone);
  const idempotencyKey = input.idempotencyKey.trim();
  if (!/^[a-zA-Z0-9._:-]{8,200}$/.test(idempotencyKey)) {
    throw new Error(
      "No fue posible identificar el intento de registro. Recarga la página e inténtalo otra vez.",
    );
  }

  const db = getControlDb();
  const existingUser = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  // The external response is deliberately identical. An existing account must never create a tenant through signup.
  if (existingUser) return { accepted: true, existingAccount: true };

  const now = new Date();
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SIGNUP_TOKEN_TTL_MS);
  const ipHash = hashSecurityIdentifier(`ip:${input.ip}`);
  const fingerprintHash = input.fingerprint?.trim()
    ? hashSecurityIdentifier(`fp:${input.fingerprint.trim().slice(0, 500)}`)
    : null;
  const data = {
    email,
    name,
    displayName,
    requestedSlug,
    timeZone,
    passwordHash: await bcrypt.hash(password, 12),
    tokenHash: tokenHash(token),
    expiresAt,
    status: "PENDING" as const,
    utm: safeUtm(input.utm),
    ipHash,
    fingerprintHash,
    verifiedAt: null,
    consumedAt: null,
    userId: null,
    tenantId: null,
  };
  const existingIntent = await db.signupIntent.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  const termsVersion = process.env.LEGAL_TERMS_VERSION?.trim() || "2026-09-03";
  const privacyVersion =
    process.env.LEGAL_PRIVACY_VERSION?.trim() || "2026-09-03";
  const intent = existingIntent
    ? await db.signupIntent.update({
        where: { id: existingIntent.id },
        data,
        select: { id: true, email: true, displayName: true },
      })
    : await db.signupIntent.create({
        data: {
          ...data,
          idempotencyKey,
          legalAcceptances: {
            create: { termsVersion, privacyVersion, ipHash },
          },
        },
        select: { id: true, email: true, displayName: true },
      });
  try {
    await sendSignupVerification(intent, token);
  } catch {
    await db.signupIntent.update({
      where: { id: intent.id },
      data: { status: "CANCELLED" },
    });
    throw new Error(
      "No fue posible enviar el correo de verificación. Inténtalo de nuevo en unos minutos.",
    );
  }
  return { accepted: true, existingAccount: false };
}

export async function verifySignupIntent(rawToken: string) {
  const hash = tokenHash(rawToken.trim());
  const db = getControlDb();
  const now = new Date();
  const intent = await db.signupIntent.findUnique({
    where: { tokenHash: hash },
    include: { tenant: { select: { slug: true } } },
  });
  if (!intent || intent.status !== "PENDING" || intent.expiresAt <= now) {
    if (intent?.status === "PENDING" && intent.expiresAt <= now) {
      await db.signupIntent.update({
        where: { id: intent.id },
        data: { status: "EXPIRED" },
      });
    }
    return null;
  }

  try {
    return await db.$transaction(
      async (tx) => {
        const current = await tx.signupIntent.findUnique({
          where: { id: intent.id },
        });
        if (
          !current ||
          current.status !== "PENDING" ||
          current.tokenHash !== hash ||
          current.expiresAt <= now
        )
          return null;
        const [existingUser, existingTenant] = await Promise.all([
          tx.user.findUnique({
            where: { email: current.email },
            select: { id: true },
          }),
          tx.tenant.findUnique({
            where: { slug: current.requestedSlug },
            select: { id: true },
          }),
        ]);
        if (existingUser || existingTenant) {
          await tx.signupIntent.update({
            where: { id: current.id },
            data: { status: "CANCELLED", consumedAt: now },
          });
          return null;
        }

        const user = await tx.user.create({
          data: {
            email: current.email,
            name: current.name,
            passwordHash: current.passwordHash,
            emailVerifiedAt: now,
          },
          select: { id: true },
        });
        const tenant = await tx.tenant.create({
          data: {
            slug: current.requestedSlug,
            displayName: current.displayName,
            timeZone: current.timeZone,
            createdByUserId: user.id,
            memberships: { create: { userId: user.id, role: "OWNER" } },
          },
          select: { id: true, slug: true },
        });
        await tx.provisioningJob.create({
          data: {
            tenantId: tenant.id,
            kind: "CREATE_TENANT_DATABASE",
            idempotencyKey: `signup-intent:${current.id}`,
            payload: {
              requestedByUserId: user.id,
              source: "verified-public-signup",
              signupIntentId: current.id,
            },
          },
        });
        await tx.legalAcceptance.updateMany({
          where: { signupIntentId: current.id },
          data: { userId: user.id },
        });
        await tx.signupIntent.update({
          where: { id: current.id },
          data: {
            status: "VERIFIED",
            verifiedAt: now,
            consumedAt: now,
            userId: user.id,
            tenantId: tenant.id,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: tenant.id,
            actorUserId: user.id,
            action: "public_signup_verified",
            resourceType: "SignupIntent",
            resourceId: current.id,
            metadata: { source: "email_verification" },
            ipHash: current.ipHash,
          },
        });
        return {
          email: current.email,
          onboardingPath: `/onboarding/${tenant.slug}`,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    )
      return null;
    throw error;
  }
}

export async function requestPasswordReset(emailInput: string, ip: string) {
  const email = normalizeEmail(emailInput);
  const db = getControlDb();
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user) return;

  const now = new Date();
  const token = newToken();
  await db.$transaction([
    db.passwordResetToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: now },
    }),
    db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(token),
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
        ipHash: hashSecurityIdentifier(`ip:${ip}`),
      },
    }),
  ]);
  const url = `${publicBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await recordAndSendEmail({
    userId: user.id,
    recipientEmail: user.email,
    template: "password_reset",
    subject: "Restablece tu contraseña",
    text: `Restablece tu contraseña usando este enlace: ${url}`,
    html: emailHtml(
      "Restablece tu contraseña",
      "Solicitaste restablecer la contraseña. El enlace vence en 30 minutos.",
      url,
      "Restablecer contraseña",
    ),
  });
}

export async function confirmPasswordReset(rawToken: string, password: string) {
  const hash = tokenHash(rawToken.trim());
  const cleanPassword = validatePassword(password);
  const now = new Date();
  const db = getControlDb();
  return db.$transaction(async (tx) => {
    const reset = await tx.passwordResetToken.findUnique({
      where: { tokenHash: hash },
    });
    if (!reset || reset.consumedAt || reset.expiresAt <= now) return false;
    const consumed = await tx.passwordResetToken.updateMany({
      where: { id: reset.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return false;
    await tx.user.update({
      where: { id: reset.userId },
      data: {
        passwordHash: await bcrypt.hash(cleanPassword, 12),
        securityVersion: { increment: 1 },
      },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: reset.userId, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: reset.userId,
        action: "password_reset",
        resourceType: "User",
        resourceId: reset.userId,
        ipHash: reset.ipHash,
      },
    });
    return true;
  });
}
