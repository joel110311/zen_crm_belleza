console.log("[Runtime] Starting the Next.js server.");
console.log("[Runtime] Tenant migrations and seed data must be applied by the provisioner before this process starts.");

try {
    await import("./server.js");
} catch (error) {
    console.error("[Runtime] Fatal startup failure:", error instanceof Error ? error.message : error);
    process.exit(1);
}
