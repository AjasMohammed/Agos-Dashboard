import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/app/theme";

/** App-wide toast surface. Follows the active theme. */
export function Toaster() {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{ classNames: { toast: "border border-border" } }}
    />
  );
}
