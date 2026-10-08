"use client";
import { RuntimeError, type RuntimeErrorProps } from "@/components/runtime-error";
// This parent boundary also catches failures in the [tenantSlug] layout itself.
export default function WorkspaceLayoutError(props: RuntimeErrorProps) { return <RuntimeError {...props} scope="este workspace" />; }
