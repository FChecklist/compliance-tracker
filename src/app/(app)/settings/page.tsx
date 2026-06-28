"use client";

import { useTheme } from "next-themes";
import {
  User,
  Palette,
  Info,
  ShieldCheck,
  Sun,
  Moon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account and preferences
        </p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <User className="size-4" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="bg-emerald-100 text-emerald-700 text-lg font-semibold">
                RS
              </AvatarFallback>
            </Avatar>
            <div className="space-y-0.5">
              <p className="font-semibold text-foreground">Rajesh Sharma</p>
              <p className="text-sm text-muted-foreground">
                admin@compliancetrack.com
              </p>
              <Badge
                variant="secondary"
                className="bg-emerald-100 text-emerald-700 text-[10px] mt-1"
              >
                Admin
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Palette className="size-4" />
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {theme === "dark" ? (
                <Moon className="size-4 text-muted-foreground" />
              ) : (
                <Sun className="size-4 text-amber-500" />
              )}
              <div>
                <Label htmlFor="theme-toggle" className="text-sm font-medium">
                  Dark Mode
                </Label>
                <p className="text-xs text-muted-foreground">
                  Switch between light and dark theme
                </p>
              </div>
            </div>
            <Switch
              id="theme-toggle"
              checked={theme === "dark"}
              onCheckedChange={(checked) =>
                setTheme(checked ? "dark" : "light")
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Info className="size-4" />
            About
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Application</span>
            <span className="text-sm font-medium flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-emerald-600" />
              ComplianceTrack
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Tagline</span>
            <span className="text-sm font-medium">
              One Portal. One Truth.
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Version</span>
            <Badge variant="outline" className="text-xs">1.0.0</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Tech Stack</span>
            <span className="text-sm text-right text-muted-foreground max-w-[250px]">
              Next.js 16, Prisma, SQLite, shadcn/ui, Tailwind CSS 4, Recharts
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Framework</span>
            <span className="text-sm text-muted-foreground">React 19 + TypeScript 5</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}