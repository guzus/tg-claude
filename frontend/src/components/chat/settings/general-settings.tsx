"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save } from "lucide-react";

export function GeneralSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">General</h2>
        <p className="text-sm text-muted-foreground mt-1">
          General application settings
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Task Limits</CardTitle>
          <CardDescription>Configure task execution limits</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Max Concurrent Tasks</label>
            <Input type="number" defaultValue="3" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Task Timeout (minutes)</label>
            <Input type="number" defaultValue="30" />
          </div>
          <Button>
            <Save className="w-4 h-4 mr-1.5" />
            Save Changes
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Git Configuration</CardTitle>
          <CardDescription>Default git settings for repositories</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">User Name</label>
            <Input placeholder="Your Name" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">User Email</label>
            <Input type="email" placeholder="you@example.com" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Default Branch</label>
            <Input placeholder="main" />
          </div>
          <Button>
            <Save className="w-4 h-4 mr-1.5" />
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
