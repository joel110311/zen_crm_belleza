import assert from "node:assert/strict";
import test from "node:test";
import type { ReactElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mts";

const mod = loadTsModule("src/components/portal/appointment-request-actions.tsx", { "@/components/ui/button": { Button: "button" } });
const render = mod.AppointmentRequestActions as (props: { disabled: boolean; onDecision: (status: string) => void }) => ReactElement<{ children: ReactElement<{ disabled: boolean; onClick: () => void }>[] }>;
for (const disabled of [false, true]) {
    test(`request review only offers confirm and reject; disabled=${disabled}`, () => {
        const decisions: string[] = [];
        const buttons = render({ disabled, onDecision: status => decisions.push(status) }).props.children;
        assert.equal(buttons.length, 2);
        for (const button of buttons) { assert.equal(button.props.disabled, disabled); button.props.onClick(); }
        assert.deepEqual(decisions, disabled ? [] : ["confirmed", "cancelled"]);
    });
}
