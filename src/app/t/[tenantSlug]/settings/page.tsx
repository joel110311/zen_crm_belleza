import { SettingsWorkspace } from "@/app/dashboard/settings/page";
import { isMultitenantChannelsEnabled } from "@/lib/multitenant-features";

export default function TenantSettingsPage() {
    return <SettingsWorkspace channelsEnabled={isMultitenantChannelsEnabled()} />;
}
