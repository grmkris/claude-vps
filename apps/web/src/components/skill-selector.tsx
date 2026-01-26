"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search, Sparkles } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { orpc } from "@/utils/orpc";

interface SkillSelectorProps {
  value: string[];
  onChange: (skills: string[]) => void;
}

export function SkillSelector({ value, onChange }: SkillSelectorProps) {
  const [search, setSearch] = useState("");

  const {
    data: catalog,
    isLoading,
    error,
  } = useQuery(orpc.skill.catalog.queryOptions({}));

  const toggleSkill = (skillId: string) => {
    if (value.includes(skillId)) {
      onChange(value.filter((id) => id !== skillId));
    } else {
      onChange([...value, skillId]);
    }
  };

  const filteredSkills =
    catalog?.skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(search.toLowerCase()) ||
        skill.description?.toLowerCase().includes(search.toLowerCase())
    ) ?? [];

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        Failed to load skills catalog. Please try again later.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <Label className="text-sm font-medium">Skills (Optional)</Label>
        </div>
        {value.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {value.length} selected
          </span>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search skills..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-10"
        />
      </div>

      <div className="rounded-lg border bg-secondary/20 max-h-64 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {search ? "No skills match your search" : "No skills available"}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredSkills.map((skill) => {
              const isSelected = value.includes(skill.id);
              return (
                <button
                  type="button"
                  key={skill.id}
                  onClick={() => toggleSkill(skill.id)}
                  className={cn(
                    "w-full px-4 py-3 text-left transition-colors hover:bg-secondary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    isSelected && "bg-primary/5"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {skill.name}
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {skill.installs.toLocaleString()} installs
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {skill.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Skills from{" "}
        <a
          href="https://skills.sh"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          skills.sh
        </a>{" "}
        extend Claude Code with specialized instructions and tools.
      </p>
    </div>
  );
}
