"use client";

import { OperationContext, type ClientOperationContext } from "./use-operation-context";

export function OperationContextProvider({ children, initialContext }: {
    children: React.ReactNode; initialContext: ClientOperationContext;
}) {
    return <OperationContext.Provider value={initialContext}>{children}</OperationContext.Provider>;
}
