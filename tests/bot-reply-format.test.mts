import test from "node:test";
import assert from "node:assert/strict";
import { formatBotReplyForReadability as format } from "../src/lib/ai/reply-format.ts";

test("separa introduccion, lista compacta y cierre sin alterar el texto", () => {
    assert.equal(format("Te comparto las opciones:\r\n💅 Manicure: $250\r\n\r\n🧖 Spa: $500\r\n¿Que horario prefieres?"),
        "Te comparto las opciones:\n\n💅 Manicure: $250\n🧖 Spa: $500\n\n¿Que horario prefieres?");
});
test("conserva parrafos y no separa arbitrariamente las frases de una misma idea", () => {
    assert.equal(format("  Hola.\nEsta es la misma idea.\n\n\n¿Agendamos?  "), "Hola.\nEsta es la misma idea.\n\n¿Agendamos?");
});
test("compacta listas numeradas y de viñetas, respetando negritas y enlaces", () => {
    const result = format("Opciones\n1. *Manicure*\n\n2. Pedicure\nReserva en https://example.com\n\n- Hoy\n\n- Mañana\nListo.");
    assert.equal(result, "Opciones\n\n1. *Manicure*\n2. Pedicure\n\nReserva en https://example.com\n\n- Hoy\n- Mañana\n\nListo.");
    assert.equal(format(result), result);
    assert.equal(format("\n\n"), "");
});
