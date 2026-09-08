import { toast } from "sonner";

/**
 * Copy to the clipboard with a toast either way. `navigator.clipboard` is
 * undefined on plain-http origins (non-localhost), so the failure names the
 * cause instead of throwing a TypeError into the caller.
 */
export async function copyText(text: string, label?: string): Promise<boolean> {
  if (!navigator.clipboard) {
    toast.error("Copy failed", {
      description: "Clipboard unavailable — the panel must be served over https or localhost.",
    });
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label ? `${label} copied` : "Copied");
    return true;
  } catch (err) {
    toast.error("Copy failed", { description: err instanceof Error ? err.message : undefined });
    return false;
  }
}
