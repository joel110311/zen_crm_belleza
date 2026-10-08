const LIST_ITEM = /^\s*(?:[-•*]\s+|\d{1,2}[.)]?\s+\S|\p{Extended_Pictographic}\uFE0F?\s+)/u;

/** Preserve paragraphs, keep lists compact, and separate lists from surrounding prose. */
export function formatBotReplyForReadability(reply: string) {
    const formatted: string[] = [];
    let hadBlankLine = false;
    let previousWasListItem: boolean | null = null;

    for (const rawLine of reply.replace(/\r\n?/g, "\n").trim().split("\n")) {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
            hadBlankLine = true;
            continue;
        }
        const currentIsListItem = LIST_ITEM.test(line);
        const startsOrEndsList = previousWasListItem !== null && previousWasListItem !== currentIsListItem;
        const isInsideList = previousWasListItem === true && currentIsListItem;
        if (formatted.length > 0 && !isInsideList && (hadBlankLine || startsOrEndsList)) {
            if (formatted.at(-1) !== "") formatted.push("");
        }
        formatted.push(line);
        previousWasListItem = currentIsListItem;
        hadBlankLine = false;
    }
    return formatted.join("\n");
}
