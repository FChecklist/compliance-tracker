"use client";

import { useState, useMemo } from "react";
import {
  Search,
  UserPlus,
  Building2,
  FileText,
  Receipt,
  Clock,
  AlertTriangle,
  Brain,
  Key,
  Search as SearchIcon,
  Code,
  Webhook,
  Upload,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/* ─────────────────────────── DATA ─────────────────────────── */

type Category = "Getting Started" | "Compliance Management" | "AI Features" | "Advanced";

interface HelpArticle {
  id: string;
  title: string;
  description: string;
  category: Category;
  icon: React.ElementType;
  content: string[];
}

const ARTICLES: HelpArticle[] = [
  // Getting Started
  {
    id: "creating-account",
    title: "Creating your account",
    description: "Sign up and verify your email to get started with VERIDIAN AI.",
    category: "Getting Started",
    icon: UserPlus,
    content: [
      "Getting started with VERIDIAN AI is quick and simple. Visit our signup page and enter your work email address, full name, and a strong password. We recommend using your official work email as it helps with team discovery and organisation-based features later on.",
      "After submitting the form, you'll receive a verification email within a few minutes. Click the verification link to activate your account. If you don't see the email, check your spam or junk folder. You can also request a new verification link from the login page.",
      "Once verified, you'll be taken through a brief onboarding flow where you can set up your organisation profile. This includes your company name, GSTIN (if applicable), industry sector, and preferred timezone. Completing this step ensures that compliance deadlines are calculated correctly for your jurisdiction.",
      "After onboarding, you'll land on your dashboard where you can start adding compliance items, inviting team members, and exploring AI features. The onboarding checklist at the top of the dashboard will guide you through the essential first steps.",
      "If you encounter any issues during signup, our support team is available via email at support@veridian.ai or through the in-app chat widget. We typically respond within 2 business hours.",
    ],
  },
  {
    id: "setting-up-org",
    title: "Setting up your organisation",
    description: "Configure your company profile, GSTIN, and team structure.",
    category: "Getting Started",
    icon: Building2,
    content: [
      "Your organisation profile is the foundation of your compliance tracking. Navigate to Settings → Organisation to configure your company details. Start by entering your legal entity name, which will appear on all compliance reports and documents generated through the platform.",
      "Adding your GSTIN (Goods and Services Tax Identification Number) is crucial for GST-related compliance tracking. VERIDIAN AI uses your GSTIN to fetch filing calendars, calculate due dates, and even pre-fill return forms. You can add multiple GSTINs if your organisation operates across different states or has multiple business verticals (available on the Enterprise plan).",
      "Next, set up your department structure. Departments help you organise compliance items by functional area — Finance, Legal, HR, Operations, etc. Each department can have its own assigned team members, making it easy to route compliance tasks to the right people. You can create departments from the Departments page in the sidebar.",
      "Finally, configure your notification preferences. VERIDIAN AI sends automated reminders before deadlines, status change alerts, and weekly digests. You can customise which notifications you receive and how — via email, in-app, or both. Go to Settings → Notifications to fine-tune these preferences.",
      "A well-configured organisation profile ensures that AI features like document extraction and auto-categorisation work accurately, as the system uses your industry and entity type to apply the right compliance rules.",
    ],
  },
  {
    id: "first-compliance-item",
    title: "Adding your first compliance item",
    description: "Create and track your first compliance requirement in the system.",
    category: "Getting Started",
    icon: FileText,
    content: [
      "A compliance item represents any regulatory requirement your organisation needs to fulfil — GST returns, TDS filings, MCA annual returns, PF contributions, and more. To add your first item, click the 'New Compliance Item' button on the Compliance page or use the + button in the sidebar.",
      "Fill in the essential details: title (e.g., 'GSTR-3B Monthly Return'), compliance type (GST, TDS, Income Tax, etc.), frequency (monthly, quarterly, annual, or one-time), and the responsible department. Setting the correct frequency ensures that VERIDIAN AI auto-generates recurring deadlines for you.",
      "Assign the item to a team member who will be responsible for tracking and filing it. You can also add watchers — people who should be notified about status changes but aren't the primary owner. This creates accountability and ensures nothing falls through the cracks.",
      "Upload any relevant supporting documents — previous filing copies, government notices, or reference materials. VERIDIAN AI's document extraction will automatically parse key information like amounts, dates, and section references from uploaded PDFs, saving you manual data entry.",
      "Once created, the compliance item appears on your dashboard with its next deadline clearly displayed. The status badge shows whether it's on track, approaching deadline, or overdue. Click into any item to view its full history, attached documents, comments, and activity log.",
    ],
  },
  // Compliance Management
  {
    id: "gst-filings",
    title: "Managing GST filings",
    description: "Track GSTR-1, GSTR-3B, GSTR-9, and other GST return deadlines.",
    category: "Compliance Management",
    icon: Receipt,
    content: [
      "VERIDIAN AI provides comprehensive GST filing management for all major return types: GSTR-1 (outward supplies), GSTR-3B (summary return), GSTR-9 (annual return), and GSTR-9C (reconciliation statement). Each return type is pre-configured with the correct filing frequency and due dates based on your GSTIN.",
      "When you add a GST compliance item, the system automatically sets the recurring schedule. For example, GSTR-3B is due by the 20th of the following month, while GSTR-1 is due by the 11th (for monthly filers) or 13th (for quarterly filers). These deadlines are configurable if your organisation has special extensions or different filing patterns.",
      "The compliance dashboard shows a colour-coded pendency view — green for safe, amber for approaching, red for overdue. This visual system makes it immediately clear which filings need attention. You can filter by return type, status, or assigned team member to focus on specific areas.",
      "Use the AI document extraction feature to automatically populate filing data from your purchase registers, sales data, and previous returns. Upload a JSON or CSV export from your billing software, and VERIDIAN AI will extract the relevant figures and populate draft return summaries.",
      "For organisations with multiple GSTINs, the Enterprise plan supports consolidated views across all registrations. You can see a unified filing calendar, generate cross-GSTIN reports, and identify filing gaps or inconsistencies between registrations.",
    ],
  },
  {
    id: "tds-tracking",
    title: "TDS tracking and deadlines",
    description: "Monitor TDS deductions, filing schedules, and challan payments.",
    category: "Compliance Management",
    icon: Clock,
    content: [
      "Tax Deducted at Source (TDS) compliance involves multiple steps: deducting tax, depositing challans, filing quarterly returns (Form 24Q, 26Q, 27Q), and issuing certificates (Form 16/16A). VERIDIAN AI helps you track each of these steps for every TDS section your organisation handles.",
      "Create separate compliance items for each TDS return type — 24Q for salary deductions, 26Q for non-salary payments, and 27Q for payments to non-residents. Each item can have its own responsible team member and set of supporting documents. The system tracks the quarterly filing cycle (July, October, January, May) and sends reminders 15 days before each deadline.",
      "Upload your TDS challan copies after each deposit. VERIDIAN AI's document extraction reads the BSR code, challan serial number, date, and amount from the challan PDF, automatically linking it to the corresponding compliance item. This creates an auditable trail for your records.",
      "The penalty calculator built into VERIDIAN AI can estimate interest under Section 201(1A) for late deposit of TDS and fees under Section 234E for late filing of returns. Simply enter the TDS amount and number of days delayed to get an instant liability estimate.",
      "Use the reports section to generate TDS compliance summaries — total deductions by section, challan status, filing history, and certificate issuance tracking. These reports are useful for internal audits and for responding to income tax notices.",
    ],
  },
  {
    id: "government-notices",
    title: "Handling government notices",
    description: "Upload, track, and respond to regulatory notices efficiently.",
    category: "Compliance Management",
    icon: AlertTriangle,
    content: [
      "Government notices from the Income Tax department, GST authorities, MCA, or EPFO require timely responses. Missing a notice response deadline can lead to penalties, ex-parte orders, or adverse assessments. VERIDIAN AI helps you manage notices from receipt to resolution.",
      "When you receive a notice, upload it as a document to the relevant compliance item or create a new item specifically for the notice response. VERIDIAN AI's extraction engine will parse the notice to identify: the issuing authority, notice reference number, section under which it's issued, the period in question, and the response deadline.",
      "The system automatically sets the compliance item status to 'Overdue' or 'High Priority' based on the notice deadline, ensuring it gets immediate visibility on the dashboard and in daily reminder emails. You can assign the response to a specific team member and add watchers from the legal or finance teams.",
      "Use the AI Q&A feature to ask questions about the uploaded notice. For example, 'What is the consequence of not responding to this Section 148 notice?' or 'What documents do I need to prepare for this GST scrutiny?' The AI provides contextual answers based on the notice content and relevant regulatory provisions.",
      "Track the complete lifecycle: upload notice → AI extraction → assign response owner → prepare reply → upload response proof → mark resolved. Each step is logged in the activity timeline, creating a complete audit trail. This is invaluable during internal audits or if the matter escalates to appeals.",
    ],
  },
  // AI Features
  {
    id: "ai-extraction",
    title: "Setting up AI extraction",
    description: "Configure automatic data extraction from uploaded documents.",
    category: "AI Features",
    icon: Brain,
    content: [
      "VERIDIAN AI's document extraction uses advanced language models to automatically parse compliance-related documents — government notices, challans, filing confirmations, bank statements, and more. The extracted data is structured and mapped to relevant fields in your compliance items.",
      "To use AI extraction, simply upload a document (PDF, image, or text file) to any compliance item. The system automatically triggers extraction and presents the results in a structured panel. You can review, edit, and confirm the extracted data before it's saved to the item. This human-in-the-loop approach ensures accuracy while saving significant manual effort.",
      "The extraction works best with documents that have clear structure — tables in notices, formatted challans, standard government forms. For handwritten or poorly scanned documents, the accuracy may vary. In such cases, you can manually correct the extracted data using the inline editing feature.",
      "Extraction results include: entity names, amounts, dates, section references, challan details, filing periods, and action items. The system also highlights key deadlines found in the document and can auto-create compliance items based on notice requirements.",
      "You can configure which AI provider powers the extraction in Settings → AI Configuration. By default, VERIDIAN AI uses a free platform-provided model (Groq), but you can bring your own API key from OpenAI, Anthropic, or Google AI for potentially better accuracy or faster processing.",
    ],
  },
  {
    id: "byok-config",
    title: "BYOK AI configuration",
    description: "Connect your own AI provider keys for enhanced privacy and control.",
    category: "AI Features",
    icon: Key,
    content: [
      "Bring Your Own Key (BYOK) lets you use your own AI provider API keys instead of the platform's default AI. This gives you full control over your AI usage, costs, and data privacy. Your keys are encrypted at rest and used only for your organisation's requests — they are never shared, logged, or accessible to VERIDIAN AI staff.",
      "Navigate to Settings → AI Configuration to set up your provider keys. We support four providers: Groq (free tier available), OpenAI (GPT-4o, GPT-4o-mini), Anthropic (Claude 3.5 Sonnet, Claude 3 Haiku), and Google AI (Gemini 1.5 Pro, Gemini 1.5 Flash). Each provider has different strengths — OpenAI and Anthropic excel at complex document reasoning, while Groq offers fast free inference.",
      "For each provider, you can specify which AI features it should power: Document Extraction (parsing uploaded documents), Q&A (answering questions about your compliance data), and Drafting (generating response drafts for notices and filings). You can use different providers for different features — for example, use Groq for Q&A and Anthropic for document extraction.",
      "After entering your API key, use the 'Test Connection' button to verify that the key is valid and the provider is reachable. This sends a minimal test request and confirms the connection within seconds. If the test fails, double-check your key and ensure your provider account has sufficient credits or quota.",
      "A 'Use Platform AI' toggle at the bottom of the configuration page lets you fall back to VERIDIAN AI's built-in Groq integration. This is useful as a backup if your own keys expire or run out of quota. The platform AI is free and available to all plans.",
    ],
  },
  {
    id: "semantic-search",
    title: "Semantic search guide",
    description: "Search across all your documents and compliance data using natural language.",
    category: "AI Features",
    icon: SearchIcon,
    content: [
      "Semantic search goes beyond keyword matching. Instead of searching for exact words, it understands the meaning and context of your query. For example, searching 'GST penalty for late filing' will find documents and compliance items related to GST late fees, interest under Section 50, and relevant notices — even if those exact words don't appear in the documents.",
      "Access semantic search from the global search bar (Ctrl+K / Cmd+K) or the search icon in the top navigation. Type your query in natural language — just as you would ask a colleague. The search results include compliance items, uploaded documents, comments, and activity logs, ranked by relevance.",
      "The search understands Indian compliance terminology and can handle abbreviations (TDS, GSTIN, PAN, CIN), Hindi-English mixed terms, and regulatory section numbers. You can also use it to find answers to procedural questions like 'how to file GSTR-9' or 'what is the due date for TDS quarter 3 return'.",
      "Search results show highlighted snippets from matching documents, making it easy to quickly scan and find what you need. Click on any result to navigate directly to the relevant compliance item or document. You can also filter results by type, date range, department, or compliance status.",
      "Semantic search indexes all your uploaded documents in real-time. When you upload a new document, it becomes searchable within seconds. The index is organisation-scoped, meaning each team member can only search documents they have access to based on their permissions.",
    ],
  },
  // Advanced
  {
    id: "using-api",
    title: "Using the API",
    description: "Integrate VERIDIAN AI with your existing tools via REST API.",
    category: "Advanced",
    icon: Code,
    content: [
      "VERIDIAN AI provides a comprehensive REST API that lets you integrate compliance data with your existing tools — ERP systems, accounting software, internal dashboards, or custom automation workflows. The API is available on the Professional and Enterprise plans.",
      "To get started, generate an API key from Settings → API Keys (available on Professional plan and above). Each key is associated with your organisation and inherits the permissions of the user who created it. We recommend creating separate keys for different integrations so you can rotate or revoke them independently.",
      "The API follows RESTful conventions with JSON request/response bodies. Key endpoints include: GET /api/compliance (list all items), POST /api/compliance (create new item), GET /api/compliance/:id (get item details), POST /api/compliance/:id/documents (upload document), and GET /api/compliance/stats (dashboard statistics). Full API documentation is available at docs.veridian.ai.",
      "Authenticate your requests by including your API key in the Authorization header: `Authorization: Bearer your-api-key`. All requests must be made over HTTPS. Rate limits are 100 requests per minute on Professional and 1000 requests per minute on Enterprise plans.",
      "Common integration patterns include: syncing compliance deadlines to Google Calendar or Microsoft Outlook, creating compliance items automatically from your accounting software's invoice data, and building custom dashboards that pull real-time compliance status. Webhooks (covered in a separate article) let you receive real-time event notifications.",
    ],
  },
  {
    id: "webhooks",
    title: "Setting up webhooks",
    description: "Receive real-time event notifications for compliance activities.",
    category: "Advanced",
    icon: Webhook,
    content: [
      "Webhooks allow VERIDIAN AI to push real-time event notifications to your systems. Instead of repeatedly polling the API to check for changes, you configure a webhook URL and we'll send HTTP POST requests whenever specific events occur. This is ideal for triggering automated workflows in response to compliance activities.",
      "To set up a webhook, navigate to Settings → Webhooks (Enterprise plan) and click 'Add Webhook'. Enter your endpoint URL — it must be HTTPS and return a 200 status code within 10 seconds to acknowledge receipt. Configure which events you want to subscribe to: item.created, item.status_changed, document.uploaded, deadline.approaching, and deadline.overdue.",
      "Each webhook payload includes the event type, timestamp, organisation ID, and a data object with event-specific details. For example, a deadline.approaching event includes the compliance item ID, title, due date, and assigned user. All payloads are signed with an HMAC-SHA256 signature using your webhook secret, which you can use to verify authenticity.",
      "If your endpoint is temporarily unavailable, VERIDIAN AI retries delivery with exponential backoff — up to 5 retries over 24 hours. You can monitor delivery status (success, failed, pending) in the webhook dashboard. Failed deliveries are logged with the error response body to help with debugging.",
      "Common webhook use cases include: sending Slack or Microsoft Teams notifications for overdue items, triggering CI/CD pipelines when compliance documents are uploaded, updating internal ticket systems when status changes occur, and feeding compliance events into your SIEM or monitoring tools for audit trails.",
    ],
  },
  {
    id: "bulk-import",
    title: "Bulk CSV import",
    description: "Import multiple compliance items at once using a CSV template.",
    category: "Advanced",
    icon: Upload,
    content: [
      "If you're migrating from another system or have a large number of compliance items to add, the bulk CSV import feature saves significant time. Instead of creating items one by one, you can prepare a spreadsheet with all your compliance data and import it in a single operation.",
      "Download the CSV template from the Compliance page by clicking the 'Import' button and selecting 'Download Template'. The template includes columns for: title, type (GST/TDS/IT/PF/MCA/ESIC), frequency (monthly/quarterly/annual/one-time), department, assigned_to, due_date, status, and notes. Fill in each row with one compliance item's details.",
      "When preparing your CSV, follow these guidelines: dates should be in DD/MM/YYYY format, compliance types must match the exact values in the template, and department names should match your existing departments (new departments will be created automatically). You can include up to 500 items in a single import file.",
      "Upload the filled CSV file through the Import dialog. VERIDIAN AI validates the data before importing and shows a preview table where you can review and correct any errors. Common validation errors include invalid date formats, unknown compliance types, or duplicate item titles. Fix these in the preview and confirm to proceed.",
      "The import runs in the background. You'll see a progress indicator and receive a notification when it's complete. The import log shows how many items were created, updated, or skipped. If any rows failed, you can download an error report with specific reasons for each failure, fix the issues, and re-import just the failed rows.",
    ],
  },
];

const CATEGORIES: Category[] = [
  "Getting Started",
  "Compliance Management",
  "AI Features",
  "Advanced",
];

const CATEGORY_COLORS: Record<Category, string> = {
  "Getting Started": "bg-ct-teal/10 text-ct-teal",
  "Compliance Management": "bg-ct-saffron/10 text-ct-saffron",
  "AI Features": "bg-purple-100 text-purple-700",
  "Advanced": "bg-ct-cloud text-ct-slate",
};

/* ─────────────────────────── COMPONENT ─────────────────────────── */

export default function HelpCentrePage() {
  const [search, setSearch] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return ARTICLES;
    const q = search.toLowerCase();
    return ARTICLES.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.content.some((p) => p.toLowerCase().includes(q))
    );
  }, [search]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">
          Help Centre
        </h1>
        <p className="text-sm text-ct-muted mt-1">
          Guides, tutorials, and answers to common questions
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ct-muted" />
        <Input
          placeholder="Search articles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 h-10 bg-white"
        />
      </div>

      {/* Articles by Category */}
      {CATEGORIES.map((category) => {
        const articles = filtered.filter((a) => a.category === category);
        if (articles.length === 0) return null;
        return (
          <div key={category}>
            <h2 className="text-xs font-semibold text-ct-muted uppercase mb-3">
              {category}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {articles.map((article) => (
                <Card
                  key={article.id}
                  className="rounded-xl shadow-card bg-white cursor-pointer hover:shadow-md transition-shadow group"
                  onClick={() => setSelectedArticle(article)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="size-10 rounded-xl bg-ct-cloud flex items-center justify-center shrink-0">
                        <article.icon className="size-5 text-ct-slate" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-semibold mb-2 ${CATEGORY_COLORS[category]}`}
                        >
                          {category}
                        </Badge>
                        <h3 className="text-sm font-semibold text-ct-navy group-hover:text-ct-saffron transition-colors">
                          {article.title}
                        </h3>
                        <p className="text-xs text-ct-muted mt-1 line-clamp-2">
                          {article.description}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-ct-border2 shrink-0 mt-6 group-hover:text-ct-saffron transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <Search className="size-10 text-ct-border2 mx-auto mb-3" />
          <p className="text-sm text-ct-muted">No articles match your search.</p>
          <Button
            variant="ghost"
            className="mt-2 text-sm text-ct-saffron"
            onClick={() => setSearch("")}
          >
            Clear search
          </Button>
        </div>
      )}

      {/* Article Dialog */}
      <Dialog
        open={!!selectedArticle}
        onOpenChange={(open) => !open && setSelectedArticle(null)}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedArticle && (
            <>
              <DialogHeader>
                <Badge
                  variant="secondary"
                  className={`text-[10px] font-semibold w-fit ${CATEGORY_COLORS[selectedArticle.category]}`}
                >
                  {selectedArticle.category}
                </Badge>
                <DialogTitle className="text-lg font-heading text-ct-navy mt-2">
                  {selectedArticle.title}
                </DialogTitle>
                <DialogDescription className="text-sm">
                  {selectedArticle.description}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                {selectedArticle.content.map((paragraph, i) => (
                  <p
                    key={i}
                    className="text-sm text-ct-slate leading-relaxed"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}