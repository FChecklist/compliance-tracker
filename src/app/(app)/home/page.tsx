"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToDoTab } from "@/components/home/ToDoTab";
import { AnalyticsTab } from "@/components/home/AnalyticsTab";
import { ApprovalTab } from "@/components/home/ApprovalTab";

// Wave 15: universal Home Page -- the same 3 tabs for every rank (To Do /
// Analytics / Approval). Only each tab's CONTENT varies by role; the tabs
// themselves are never renamed, hidden, or swapped for a different set.
export default function HomePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Home</h1>
      </div>

      <Tabs defaultValue="todo">
        <TabsList>
          <TabsTrigger value="todo">To Do</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="approval">Approval</TabsTrigger>
        </TabsList>
        <TabsContent value="todo" className="mt-4"><ToDoTab /></TabsContent>
        <TabsContent value="analytics" className="mt-4"><AnalyticsTab /></TabsContent>
        <TabsContent value="approval" className="mt-4"><ApprovalTab /></TabsContent>
      </Tabs>
    </div>
  );
}
