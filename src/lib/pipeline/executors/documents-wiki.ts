// PROJEXA-BUILD-002 WP-05g (register row AW-307, wave 8) -- permits, document details and the project wiki: create_permit,
// update_document_metadata, create_wiki_page and update_wiki_page.
//
// Each wraps the service PROJEXA's own route calls (document-service.ts createDocumentRecord and updateDocumentMetadata, pms-wiki-service.ts
// createWikiPage and updateWikiPage). No second write path.
//   - create_permit records a permit the way the permits route does: a document of category "permit" linked to the project, with the permit
//     number, the authority and the issue date in its metadata and the end date as its expiry. It is LINK-ONLY, like create_document and
//     create_drawing: a task carries JSON, not a file's bytes, so the permit points at an https address that is stored as written and never
//     fetched. A new permit moves the "permits expiring" tile of the project dashboard, so the dashboard cache is dropped as the route does;
//   - update_document_metadata changes a project document's name, category and expiry date. It never re-links a document to another project
//     and never patches metadata (the service only allows that for drawings, and the route does not pass it);
//   - create_wiki_page and update_wiki_page write plain text pages. The page is given an unused slug by the service. A page can be renamed and
//     its text replaced, and nothing else: archiving a page stays with the person. A parent page must be a page of THIS project.
//
// Rules, each with a test in src/lib/pipeline/coverage-wave8-9.test.ts:
//   - the document, the page and the parent page are held to the task's project (the services find them by id and organisation only);
//   - the acting person is recorded, never the API key (uploadedById, updatedById); the wiki update wants the person's user row;
//   - free text is cleaned and held to 2,000 characters; the permit's address must be https; dates must be real days.
import { createDocumentRecord, updateDocumentMetadata } from "@/lib/services/document-service";
import { bustProjectDashboardCache } from "@/lib/services/project-dashboard-cache";
import { createWikiPage, updateWikiPage } from "@/lib/services/pms-wiki-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { badRequest, created, RANK_MEMBER, refuse } from "./common";
import { pipelineFailure } from "../error-codes";
import { bad, BAD, guarded, needDate, needText, notFound, optDate, projectExists } from "./record-scope";
import { isHttpsUrl } from "./scope";
import { given, loadActor, needClean, optClean, optId, recordOfProject } from "./wave79-scope";

export async function executeCreatePermit(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const name = needClean(task, "name");
    if (name === BAD) return bad(task, "name");
    const externalUrl = needClean(task, "externalUrl");
    if (externalUrl === BAD || !isHttpsUrl(externalUrl)) return bad(task, "externalUrl");
    const permitNumber = needClean(task, "permitNumber");
    if (permitNumber === BAD) return bad(task, "permitNumber");
    const permitAuthority = needClean(task, "permitAuthority");
    if (permitAuthority === BAD) return bad(task, "permitAuthority");
    const expiryDate = needDate(task, "expiryDate");
    if (expiryDate === BAD) return bad(task, "expiryDate");
    const issueDate = optDate(task, "issueDate");
    if (issueDate === BAD || (issueDate !== undefined && issueDate > expiryDate)) return bad(task, "issueDate");
    // createDocumentRecord() links a document to any id it is given: the project must exist in this organisation.
    if (!(await projectExists(task, projectId))) return notFound(task, "projectId");

    const doc = await createDocumentRecord(
      { orgId: task.orgId, userId: actorId },
      {
        name, externalUrl, category: "permit", expiryDate,
        linkedEntityType: "project", linkedEntityId: projectId,
        metadata: { permitAuthority, permitNumber, issueDate: issueDate ?? null },
      }
    );
    bustProjectDashboardCache(task.orgId, projectId);
    return created(doc.id, `/permits/${doc.id}`, doc);
  });
}

export async function executeUpdateDocumentMetadata(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const documentId = needText(task, "documentId");
    if (documentId === BAD) return bad(task, "documentId");
    const name = optClean(task, "name");
    const category = optClean(task, "category");
    if (name === BAD || (given(task, "name") && name === undefined)) return bad(task, "name");
    if (category === BAD || (given(task, "category") && category === undefined) || (category !== undefined && category.length > 60)) return bad(task, "category");
    const expiryDate = optDate(task, "expiryDate");
    if (expiryDate === BAD) return bad(task, "expiryDate");
    if (name === undefined && category === undefined && expiryDate === undefined) return badRequest(task, "nothing_to_change");
    if (!(await recordOfProject(task, "document", documentId, projectId))) return notFound(task, "documentId");

    const doc = await updateDocumentMetadata(
      { orgId: task.orgId, userId: actorId },
      documentId,
      { ...(name !== undefined ? { name } : {}), ...(category !== undefined ? { category } : {}), ...(expiryDate !== undefined ? { expiryDate } : {}) }
    );
    bustProjectDashboardCache(task.orgId, projectId);
    return created(doc.id, `/documents/${doc.id}`, doc);
  });
}

export async function executeCreateWikiPage(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const title = needClean(task, "title");
    if (title === BAD) return bad(task, "title");
    const content = optClean(task, "content");
    if (content === BAD || (given(task, "content") && content === undefined)) return bad(task, "content");
    const parentPageId = optId(task, "parentPageId");
    if (parentPageId === BAD) return bad(task, "parentPageId");
    if (parentPageId !== undefined && !(await recordOfProject(task, "wiki_page", parentPageId, projectId))) return notFound(task, "parentPageId");

    // The service checks the project itself (a project of another organisation is its own 404) and gives the page an unused slug.
    const page = await createWikiPage({ orgId: task.orgId, userId: actorId, isRealUser: true }, projectId, { title, content, parentPageId });
    return created(page.id, `/wiki/${page.id}`, page);
  });
}

export async function executeUpdateWikiPage(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const pageId = needText(task, "pageId");
    if (pageId === BAD) return bad(task, "pageId");
    const title = optClean(task, "title");
    const content = optClean(task, "content");
    if (title === BAD || (given(task, "title") && title === undefined)) return bad(task, "title");
    if (content === BAD || (given(task, "content") && content === undefined)) return bad(task, "content");
    if (title === undefined && content === undefined) return refuse(pipelineFailure("VALUE_REQUIRED", ["value"]));
    if (!(await recordOfProject(task, "wiki_page", pageId, projectId))) return notFound(task, "pageId");
    const built = await loadActor(task, actorId);
    if ("failure" in built) return built.failure;

    const page = await updateWikiPage(
      { orgId: task.orgId, userId: built.actor.id, dbUser: built.actor },
      pageId,
      { ...(title !== undefined ? { title } : {}), ...(content !== undefined ? { content } : {}) }
    );
    return created(page.id, `/wiki/${page.id}`, page);
  });
}
