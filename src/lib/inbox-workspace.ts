/** Drafts stay within this mounted business workspace and never cross conversations. */
export function switchConversationDraft<T>(
  cache: Map<string, T>,
  previousId: string | null,
  nextId: string | null,
  current: T,
  empty: T,
): T {
  if (previousId) cache.set(previousId, current);
  return nextId ? (cache.get(nextId) ?? empty) : empty;
}

export function forwardMessagePayload(
  target: { id: string; sourceType: string; sourceId?: string | null },
  content: string,
) {
  return {
    conversationId: target.id,
    content,
    direction: "outbound",
    sourceType: target.sourceType,
    sourceId: target.sourceId || null,
  };
}

export function isActiveConversationResult(
  activeId: string | null,
  requestedId: string,
) {
  return activeId !== null && activeId === requestedId;
}

/** Failed sends recover their draft without replacing newer typing, files or reply intent. */
export function recoverFailedConversationDraft<
  T extends { text: string; file: unknown; reply: unknown },
>(current: T | undefined, attempted: T): T {
  return current && (current.text.trim() || current.file || current.reply)
    ? current
    : attempted;
}

export function matchesConversationSearch(
  contact: { name?: string | null; phone?: string | null },
  preview: string,
  query: string,
) {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("es-MX")
      .trim();
  const term = normalize(query);
  if (!term) return true;
  const digits = query.replace(/\D/g, "");
  return (
    [contact.name || "", contact.phone || "", preview].some((value) =>
      normalize(value).includes(term),
    ) ||
    (/^[+\d\s().-]+$/.test(query) &&
      digits.length > 0 &&
      (contact.phone || "").replace(/\D/g, "").includes(digits))
  );
}
