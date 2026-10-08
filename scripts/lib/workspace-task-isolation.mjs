/** A disconnected or failing workspace must not starve the rest of a scheduled pass. */
export async function runIsolatedWorkspaceTasks(workspaces, task, onFailure) {
    let processed = 0;
    let failed = 0;
    for (const workspace of workspaces) {
        try {
            await task(workspace);
            processed += 1;
        } catch (error) {
            failed += 1;
            onFailure(workspace, error);
        }
    }
    return { processed, failed };
}
