import { prisma } from "@/lib/db";
import { buildPhoneMatchClauses, isPlausiblePhoneDigits, normalizePhoneDigits } from "@/lib/phone";
import { decodeCsvBuffer, normalizeCsvCell, normalizeCsvHeader, parseCsvRows } from "@/lib/csv";

type BulkCampaignCsvImportOptions = {
    defaultStatus?: string;
    importTag?: string;
};

type ParsedCsvContactRow = {
    phone: string;
    name: string;
    lastName: string;
    email: string;
    company: string;
    role: string;
    status: string;
    tags: string[];
};

const VALID_CONTACT_STATUSES = new Set(["lead", "qualified", "customer"]);

function getFirstValue(
    row: Record<string, string>,
    aliases: string[],
) {
    for (const alias of aliases) {
        const value = normalizeCsvCell(row[alias]);
        if (value) return value;
    }
    return "";
}

function normalizeStatus(value: string | null | undefined, fallback = "lead") {
    const normalized = (value || "").trim().toLowerCase();
    if (VALID_CONTACT_STATUSES.has(normalized)) {
        return normalized;
    }
    return fallback;
}

function parseTags(value: string | undefined) {
    return (value || "")
        .split(/[;,|]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry, index, entries) => entries.indexOf(entry) === index);
}

function mergeTags(...values: Array<string[]>) {
    const merged = values.flatMap((entry) => entry);
    return merged.filter((entry, index) => merged.indexOf(entry) === index);
}

function mapCsvContacts(source: string, options: Required<BulkCampaignCsvImportOptions>) {
    const rawRows = parseCsvRows(source);
    if (rawRows.length < 2) {
        throw new Error("El CSV no trae suficientes filas para importar.");
    }

    const headers = rawRows[0].map((header) => normalizeCsvHeader(header));
    const deduplicatedByPhone = new Map<string, ParsedCsvContactRow>();
    let invalidRows = 0;

    for (const cells of rawRows.slice(1)) {
        const row = headers.reduce<Record<string, string>>((accumulator, header, index) => {
            accumulator[header] = cells[index] || "";
            return accumulator;
        }, {});

        const phone = normalizePhoneDigits(
            getFirstValue(row, ["phone", "telefono", "telefono_whatsapp", "celular", "mobile", "numero", "whatsapp", "tel"]),
        );

        if (!isPlausiblePhoneDigits(phone)) {
            invalidRows += 1;
            continue;
        }

        deduplicatedByPhone.set(phone, {
            phone,
            name: getFirstValue(row, ["name", "nombre", "first_name", "firstname"]),
            lastName: getFirstValue(row, ["last_name", "lastname", "apellido", "apellidos"]),
            email: getFirstValue(row, ["email", "correo", "correo_electronico", "mail"]),
            company: getFirstValue(row, ["company", "empresa", "compania"]),
            role: getFirstValue(row, ["role", "puesto", "cargo"]),
            status: normalizeStatus(
                getFirstValue(row, ["status", "estado"]),
                options.defaultStatus || "lead",
            ),
            tags: mergeTags(
                parseTags(getFirstValue(row, ["tags", "tag", "etiquetas"])),
                options.importTag ? [options.importTag] : [],
            ),
        });
    }

    return {
        rows: [...deduplicatedByPhone.values()],
        invalidRows,
    };
}

export async function importBulkCampaignContactsFromCsv(
    buffer: Buffer,
    options: BulkCampaignCsvImportOptions = {},
) {
    const normalizedOptions: Required<BulkCampaignCsvImportOptions> = {
        defaultStatus: normalizeStatus(options.defaultStatus || "lead", "lead"),
        importTag: (options.importTag || "").trim(),
    };
    const source = decodeCsvBuffer(buffer);
    const { rows, invalidRows } = mapCsvContacts(source, normalizedOptions);

    if (rows.length === 0) {
        throw new Error("No encontre filas validas en el CSV de contactos.");
    }

    let createdCount = 0;
    let updatedCount = 0;

    await prisma.$transaction(async (tx) => {
        for (const row of rows) {
            const existing = await tx.contact.findFirst({
                where: {
                    OR: buildPhoneMatchClauses([row.phone]),
                },
            });

            if (!existing) {
                await tx.contact.create({
                    data: {
                        phone: row.phone,
                        name: row.name || null,
                        lastName: row.lastName || null,
                        email: row.email || null,
                        company: row.company || null,
                        role: row.role || null,
                        status: row.status,
                        tags: row.tags,
                    },
                });
                createdCount += 1;
                continue;
            }

            await tx.contact.update({
                where: { id: existing.id },
                data: {
                    name: row.name || existing.name,
                    lastName: row.lastName || existing.lastName,
                    email: row.email || existing.email,
                    company: row.company || existing.company,
                    role: row.role || existing.role,
                    status: row.status || existing.status,
                    tags: mergeTags(existing.tags, row.tags),
                },
            });
            updatedCount += 1;
        }
    });

    return {
        importedCount: rows.length,
        createdCount,
        updatedCount,
        invalidRows,
        appliedStatus: normalizedOptions.defaultStatus,
        appliedTag: normalizedOptions.importTag || null,
    };
}
