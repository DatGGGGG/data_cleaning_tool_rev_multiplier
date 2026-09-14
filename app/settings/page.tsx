import { SettingsEditor } from "@/components/settings-editor";
import { getPublicAppSettings } from "@/lib/app-settings/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const initialSettings = await getPublicAppSettings();

  return <SettingsEditor initialSettings={initialSettings} />;
}
