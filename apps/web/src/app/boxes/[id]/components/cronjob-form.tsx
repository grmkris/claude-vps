"use client";

import type { BoxCronjobId, BoxId } from "@vps-claude/shared";

import { X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useCreateCronjob, useUpdateCronjob } from "@/hooks/use-cronjobs";

interface Cronjob {
  id: BoxCronjobId;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
}

interface CronjobFormProps {
  boxId: BoxId;
  editingId: BoxCronjobId | null;
  cronjob?: Cronjob;
  onClose: () => void;
}

const SCHEDULE_PRESETS = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Daily at 9am", value: "0 9 * * *" },
  { label: "Weekdays at 9am", value: "0 9 * * 1-5" },
  { label: "Weekly on Monday", value: "0 0 * * 1" },
];

export function CronjobForm({
  boxId,
  editingId,
  cronjob,
  onClose,
}: CronjobFormProps) {
  const createCronjob = useCreateCronjob(boxId);
  const updateCronjob = useUpdateCronjob(boxId);

  const [name, setName] = useState(cronjob?.name ?? "");
  const [schedule, setSchedule] = useState(cronjob?.schedule ?? "0 9 * * *");
  const [prompt, setPrompt] = useState(cronjob?.prompt ?? "");

  const isPending = createCronjob.isPending || updateCronjob.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingId) {
      await updateCronjob.mutateAsync({
        id: editingId,
        name,
        schedule,
        prompt,
      });
    } else {
      await createCronjob.mutateAsync({
        name,
        schedule,
        prompt,
      });
    }

    onClose();
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="font-medium">
          {editingId ? "Edit Cronjob" : "New Cronjob"}
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Daily summary"
            className="mt-1 w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            required
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="schedule">
            Schedule
          </label>
          <div className="mt-1 flex gap-2">
            <select
              value={
                SCHEDULE_PRESETS.find((p) => p.value === schedule)
                  ? schedule
                  : "custom"
              }
              onChange={(e) => {
                if (e.target.value !== "custom") {
                  setSchedule(e.target.value);
                }
              }}
              className="flex-1 px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {SCHEDULE_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </div>
          <input
            id="schedule"
            type="text"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 9 * * *"
            className="mt-2 w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            required
          />
          <p className="text-xs text-muted-foreground mt-1">
            Cron format: minute hour day-of-month month day-of-week (UTC)
          </p>
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="prompt">
            Prompt
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should Claude do when this job runs?"
            rows={4}
            className="mt-1 w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            required
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving..." : editingId ? "Update" : "Create"}
          </Button>
        </div>
      </form>
    </div>
  );
}
