"use client";
import { Plus } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AddContent } from "@/components/add-content";

/** Floating "+" button that opens the "Add to your library" flow in a modal. */
export function AddContentModal({ kbId }: { kbId: string }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="icon"
            aria-label="Add to your library"
            className="fixed bottom-6 right-6 z-40 size-14 rounded-full shadow-lg"
          >
            <Plus className="size-6" />
          </Button>
        }
      />
      <DialogContent className="max-w-xl">
        <DialogTitle>Add to your library</DialogTitle>
        <AddContent kbId={kbId} />
      </DialogContent>
    </Dialog>
  );
}
