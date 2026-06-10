import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useInstallTool } from "@/api/queries/tools";
import { toastError } from "@/lib/errors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InstallToolDialog() {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const install = useInstallTool();

  // Mirror the kernel's path-traversal guard client-side for instant feedback.
  const traversal = path.includes("..");
  const disabled = install.isPending || traversal || !path.trim();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    try {
      await install.mutateAsync(path.trim());
      toast.success("Tool installed");
      setPath("");
      setOpen(false);
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Install tool</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install tool</DialogTitle>
          <DialogDescription>Register a tool from a manifest (.toml) path.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Manifest path</Label>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              autoFocus
              placeholder="tools/user/my-tool.toml"
            />
            {traversal && (
              <p className="text-sm text-destructive">
                Path must not contain “..” — directory traversal is blocked.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              {install.isPending ? "Installing…" : "Install"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
