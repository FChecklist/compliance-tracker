"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToDoTab } from "@/components/home/ToDoTab";
import { AnalyticsTab } from "@/components/home/AnalyticsTab";
import { ApprovalTab } from "@/components/home/ApprovalTab";

// Dashboard (2026-07-06): the classic tabbed workspace (Analytics / To Do /
// Approval) that used to be Home. Home is now the assistant-first screen;
// this is the "numbers and lists" view for when the user wants to dig in
// themselves. Opens on Analytics by default -- the at-a-glance picture --
// per demo feedback. The three tabs are unchanged (Wave 15's rule that every
// rank sees the same three, only the content varies by role).
export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Dashboard</h1>
      </div>

      <Tabs defaultValue="analytics">
        <TabsList>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="todo">To Do</TabsTrigger>
          <TabsTrigger value="approval">Approval</TabsTrigger>
        </TabsList>
        <TabsContent value="analytics" className="mt-4"><AnalyticsTab /></TabsContent>
        <TabsContent value="todo" className="mt-4"><ToDoTab /></TabsContent>
        <TabsContent value="approval" className="mt-4"><ApprovalTab /></TabsContent>
      </Tabs>
    </div>
  );
}
