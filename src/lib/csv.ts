function countMatches(source: string, pattern: RegExp) {
    return (source.match(pattern) || []).length;
}

function scoreDecodedCsvText(source: string) {
    const replacementChars = countMatches(source, /\uFFFD/g);
    const mojibakeHints = countMatches(source, /Ãƒ.|Ã‚.|Ã¢â‚¬Â¦|Ã¢â‚¬Å“|Ã¢â‚¬|Ã¢â‚¬"|Ã¢â‚¬â„¢|Ã¢â‚¬â€œ|Ã¢â‚¬â€/g);
    const controlChars = countMatches(source, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g);
    const spanishChars = countMatches(source, /[Ã¡Ã©Ã­Ã³ÃºÃÃ‰ÃÃ“ÃšÃ±Ã‘Â¿Â¡]/g);
    const printableChars = countMatches(source, /[A-Za-z0-9Ã¡Ã©Ã­Ã³ÃºÃÃ‰ÃÃ“ÃšÃ±Ã‘Â¿Â¡.,;:()_\-\/"'@\s]/g);

    return (
        printableChars +
        spanishChars * 6 -
        replacementChars * 120 -
        mojibakeHints * 50 -
        controlChars * 120
    );
}

export function decodeCsvBuffer(buffer: Buffer) {
    if (buffer.length === 0) {
        return "";
    }

    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return new TextDecoder("utf-8").decode(buffer);
    }

    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(buffer);
    }

    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        return new TextDecoder("utf-16be").decode(buffer);
    }

    const looksLikeUtf16 =
        buffer.subarray(0, Math.min(buffer.length, 512)).some((byte, index) =>
            index % 2 === 1 ? byte === 0 : false,
        );

    if (looksLikeUtf16) {
        const utf16le = new TextDecoder("utf-16le").decode(buffer);
        const utf16be = new TextDecoder("utf-16be").decode(buffer);
        return scoreDecodedCsvText(utf16le) >= scoreDecodedCsvText(utf16be)
            ? utf16le
            : utf16be;
    }

    const utf8 = new TextDecoder("utf-8").decode(buffer);
    const windows1252 = new TextDecoder("windows-1252").decode(buffer);

    return scoreDecodedCsvText(utf8) >= scoreDecodedCsvText(windows1252)
        ? utf8
        : windows1252;
}

export function parseCsvRows(source: string) {
    const rows: string[][] = [];
    let currentCell = "";
    let currentRow: string[] = [];
    let inQuotes = false;

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        const nextChar = source[index + 1];

        if (char === "\"") {
            if (inQuotes && nextChar === "\"") {
                currentCell += "\"";
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === "," && !inQuotes) {
            currentRow.push(currentCell);
            currentCell = "";
            continue;
        }

        if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && nextChar === "\n") {
                index += 1;
            }
            currentRow.push(currentCell);
            if (currentRow.some((cell) => cell.trim().length > 0)) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentCell = "";
            continue;
        }

        currentCell += char;
    }

    currentRow.push(currentCell);
    if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow);
    }

    return rows;
}

export function normalizeCsvHeader(value: string) {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

export function normalizeCsvCell(value: string | undefined) {
    return (value || "").trim();
}
