import React from "react";
import { cn } from "@/lib/utils";

type WhatsAppFormattedTextProps = {
    text: string;
    className?: string;
    variableClassName?: string;
};

const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi;
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;

function normalizeHref(rawUrl: string) {
    return rawUrl.startsWith("www.") ? `https://${rawUrl}` : rawUrl;
}

function splitTrailingPunctuation(rawUrl: string) {
    const match = rawUrl.match(/([).,!?:;]+)$/);
    if (!match) {
        return { cleanUrl: rawUrl, trailing: "" };
    }

    const trailing = match[0];
    return {
        cleanUrl: rawUrl.slice(0, -trailing.length),
        trailing,
    };
}

function renderPlainTextWithLinks(text: string, keyPrefix: string): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    const regex = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = regex.exec(text)) !== null) {
        if (match[0].length === 0) {
            regex.lastIndex += 1;
            continue;
        }

        if (match.index > lastIndex) {
            nodes.push(
                <React.Fragment key={`${keyPrefix}-text-${index}`}>
                    {text.slice(lastIndex, match.index)}
                </React.Fragment>,
            );
            index += 1;
        }

        const rawUrl = match[0];
        const { cleanUrl, trailing } = splitTrailingPunctuation(rawUrl);

        nodes.push(
            <a
                key={`${keyPrefix}-link-${index}`}
                href={normalizeHref(cleanUrl)}
                target="_blank"
                rel="noreferrer noopener"
                className="cursor-pointer break-all text-sky-700 underline underline-offset-2 transition-colors hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-200"
            >
                {cleanUrl}
            </a>,
        );
        index += 1;

        if (trailing) {
            nodes.push(
                <React.Fragment key={`${keyPrefix}-trail-${index}`}>
                    {trailing}
                </React.Fragment>,
            );
            index += 1;
        }

        lastIndex = match.index + rawUrl.length;
    }

    if (lastIndex < text.length) {
        nodes.push(
            <React.Fragment key={`${keyPrefix}-tail`}>
                {text.slice(lastIndex)}
            </React.Fragment>,
        );
    }

    return nodes;
}

function normalizeMarkdownArtifacts(text: string) {
    return text
        .replace(MARKDOWN_IMAGE_REGEX, (_full, label) => label || "imagen")
        .replace(MARKDOWN_LINK_REGEX, (_full, label, url) => `${label}: ${url}`);
}

function renderInlineSegments(
    text: string,
    keyPrefix: string,
    variableClassName: string,
): React.ReactNode[] {
    const normalizedText = normalizeMarkdownArtifacts(text);
    const nodes: React.ReactNode[] = [];
    const tokenRegex = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|{{\s*[a-zA-Z0-9_]+\s*}})/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = tokenRegex.exec(normalizedText)) !== null) {
        if (match.index > lastIndex) {
            nodes.push(...renderPlainTextWithLinks(normalizedText.slice(lastIndex, match.index), `${keyPrefix}-plain-${index}`));
            index += 1;
        }

        const token = match[0];
        const tokenKey = `${keyPrefix}-token-${index}`;

        if (token.startsWith("*") && token.endsWith("*")) {
            nodes.push(
                <strong key={tokenKey} className="font-semibold text-current">
                    {renderPlainTextWithLinks(token.slice(1, -1), `${tokenKey}-bold`)}
                </strong>,
            );
        } else if (token.startsWith("_") && token.endsWith("_")) {
            nodes.push(
                <em key={tokenKey}>
                    {renderPlainTextWithLinks(token.slice(1, -1), `${tokenKey}-italic`)}
                </em>,
            );
        } else if (token.startsWith("~") && token.endsWith("~")) {
            nodes.push(
                <s key={tokenKey}>
                    {renderPlainTextWithLinks(token.slice(1, -1), `${tokenKey}-strike`)}
                </s>,
            );
        } else {
            nodes.push(
                <span key={tokenKey} className={variableClassName}>
                    {token}
                </span>,
            );
        }

        lastIndex = match.index + token.length;
        index += 1;
    }

    if (lastIndex < normalizedText.length) {
        nodes.push(...renderPlainTextWithLinks(normalizedText.slice(lastIndex), `${keyPrefix}-tail`));
    }

    return nodes;
}

export function WhatsAppFormattedText({
    text,
    className,
    variableClassName = "rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-700",
}: WhatsAppFormattedTextProps) {
    const lines = text.split("\n");

    return (
        <div className={cn("min-w-0 max-w-full break-words [overflow-wrap:anywhere] [word-break:break-word]", className)}>
            {lines.map((line, lineIndex) => (
                <React.Fragment key={`line-${lineIndex}`}>
                    {renderInlineSegments(line, `line-${lineIndex}`, variableClassName)}
                    {lineIndex < lines.length - 1 ? <br /> : null}
                </React.Fragment>
            ))}
        </div>
    );
}
