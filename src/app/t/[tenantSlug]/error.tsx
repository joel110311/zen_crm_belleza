"use client";
import { RuntimeError, type RuntimeErrorProps } from "@/components/runtime-error";
export default function WorkspacePageError(props: RuntimeErrorProps) { return <RuntimeError {...props} scope="esta sección del workspace" />; }
