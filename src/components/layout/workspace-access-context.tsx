"use client";

import { createContext, useContext } from "react";

export const WorkspaceAccessContext = createContext({ readOnly: false });
export const useWorkspaceAccess = () => useContext(WorkspaceAccessContext);
