import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { workbenchApi } from './api'
import type { Book, InvitationRole, ParticipantRole, WorkItemStatus } from './types'

export const workbenchKeys = {
  all: ['workbench'] as const,
  me: () => [...workbenchKeys.all, 'me'] as const,
  cases: () => [...workbenchKeys.all, 'cases'] as const,
  workItems: () => [...workbenchKeys.all, 'work-items'] as const,
  case: (id: string) => [...workbenchKeys.all, 'case', id] as const,
  caseWorkItems: (id: string) => [...workbenchKeys.case(id), 'work-items'] as const,
  documents: (id: string) => [...workbenchKeys.case(id), 'documents'] as const,
  revisions: (documentId: string) => [...workbenchKeys.all, 'revisions', documentId] as const,
  figures: (id: string) => [...workbenchKeys.case(id), 'figures'] as const,
  proposals: (id: string) => [...workbenchKeys.case(id), 'proposals'] as const,
  releases: (id: string) => [...workbenchKeys.case(id), 'releases'] as const,
  releaseItems: (releaseId: string) => [...workbenchKeys.all, 'release-items', releaseId] as const,
  releaseArtifacts: (releaseId: string) => [...workbenchKeys.all, 'release-artifacts', releaseId] as const,
  preflight: (id: string) => [...workbenchKeys.case(id), 'preflight'] as const,
  participants: (id: string) => [...workbenchKeys.case(id), 'participants'] as const,
  memberships: (orgId: string) => [...workbenchKeys.all, 'memberships', orgId] as const,
  approvals: () => [...workbenchKeys.all, 'approvals'] as const,
  notifications: () => [...workbenchKeys.all, 'notifications'] as const,
}

export function useWorkbenchQueries(caseId: string | null) {
  const me = useQuery({ queryKey: workbenchKeys.me(), queryFn: ({ signal }) => workbenchApi.me(signal) })
  const cases = useQuery({ queryKey: workbenchKeys.cases(), queryFn: ({ signal }) => workbenchApi.cases(signal) })
  const workItems = useQuery({ queryKey: workbenchKeys.workItems(), queryFn: ({ signal }) => workbenchApi.workItems(signal) })
  const approvals = useQuery({ queryKey: workbenchKeys.approvals(), queryFn: ({ signal }) => workbenchApi.approvals(signal) })
  const notifications = useQuery({ queryKey: workbenchKeys.notifications(), queryFn: ({ signal }) => workbenchApi.notifications(signal) })
  const selectedCase = useQuery({
    queryKey: workbenchKeys.case(caseId ?? 'none'),
    queryFn: ({ signal }) => workbenchApi.case(caseId!, signal),
    enabled: Boolean(caseId),
  })
  const caseWorkItems = useQuery({
    queryKey: workbenchKeys.caseWorkItems(caseId ?? 'none'),
    queryFn: ({ signal }) => workbenchApi.caseWorkItems(caseId!, signal),
    enabled: Boolean(caseId),
  })
  const documents = useQuery({
    queryKey: workbenchKeys.documents(caseId ?? 'none'),
    queryFn: ({ signal }) => workbenchApi.documents(caseId!, signal),
    enabled: Boolean(caseId),
  })
  const figures = useQuery({
    queryKey: workbenchKeys.figures(caseId ?? 'none'),
    queryFn: ({ signal }) => workbenchApi.figures(caseId!, signal),
    enabled: Boolean(caseId),
  })
  const proposals = useQuery({
    queryKey: workbenchKeys.proposals(caseId ?? 'none'),
    queryFn: ({ signal }) => workbenchApi.proposals(caseId!, signal),
    enabled: Boolean(caseId),
  })
  const releases = useQuery({
    queryKey: workbenchKeys.releases(caseId ?? 'none'),
    queryFn: ({ signal }) => workbenchApi.releases(caseId!, signal),
    enabled: Boolean(caseId),
  })
  const participants = useQuery({
    queryKey: workbenchKeys.participants(caseId ?? 'none'),
    queryFn: ({ signal }) => workbenchApi.participants(caseId!, signal),
    enabled: Boolean(caseId),
  })
  const memberships = useQuery({
    queryKey: workbenchKeys.memberships(selectedCase.data?.organization_id ?? 'none'),
    queryFn: ({ signal }) => workbenchApi.memberships(selectedCase.data!.organization_id, signal),
    enabled: Boolean(selectedCase.data),
  })
  return { me, cases, workItems, approvals, notifications, selectedCase, caseWorkItems, documents, figures, proposals, releases, participants, memberships }
}

export function useWorkbenchMutations() {
  const client = useQueryClient()
  const decideApproval = useMutation({
    mutationFn: ({ approvalId, decision, reason }: { approvalId: string; decision: 'approved' | 'rejected'; reason?: string }) =>
      workbenchApi.decideApproval(approvalId, decision, reason),
    onSuccess: () => client.invalidateQueries({ queryKey: workbenchKeys.approvals() }),
  })
  const setWorkItemStatus = useMutation({
    mutationFn: ({ workItemId, status }: { workItemId: string; status: WorkItemStatus }) =>
      workbenchApi.setWorkItemStatus(workItemId, status),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: workbenchKeys.workItems() })
      void client.invalidateQueries({ queryKey: [...workbenchKeys.all, 'case'] })
    },
  })
  const decideProposal = useMutation({
    mutationFn: ({ proposalId, decision }: { proposalId: string; decision: 'submit' | 'accept' | 'reject'; caseId: string }) =>
      workbenchApi.decideProposal(proposalId, decision),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: workbenchKeys.proposals(variables.caseId) })
      void client.invalidateQueries({ queryKey: workbenchKeys.documents(variables.caseId) })
    },
  })
  const markNotificationRead = useMutation({
    mutationFn: (notificationId: string) => workbenchApi.markNotificationRead(notificationId),
    onSuccess: () => client.invalidateQueries({ queryKey: workbenchKeys.notifications() }),
  })
  const createDocument = useMutation({
    mutationFn: ({ caseId, book }: { caseId: string; book: Book }) => workbenchApi.createDocument(caseId, book),
    onSuccess: (_data, variables) => client.invalidateQueries({ queryKey: workbenchKeys.documents(variables.caseId) }),
  })
  const createRelease = useMutation({
    mutationFn: (caseId: string) => workbenchApi.createRelease(caseId),
    onSuccess: (_data, caseId) => client.invalidateQueries({ queryKey: workbenchKeys.releases(caseId) }),
  })
  const sealRelease = useMutation({
    mutationFn: ({ releaseId }: { releaseId: string; caseId: string }) => workbenchApi.sealRelease(releaseId),
    onSuccess: (_data, variables) => client.invalidateQueries({ queryKey: workbenchKeys.releases(variables.caseId) }),
  })
  const createFigure = useMutation({
    mutationFn: ({ caseId, figureNo, title }: { caseId: string; figureNo: number | null; title: string }) =>
      workbenchApi.createFigure(caseId, { figure_no: figureNo, title }),
    onSuccess: (_data, variables) => client.invalidateQueries({ queryKey: workbenchKeys.figures(variables.caseId) }),
  })
  const uploadFigureImage = useMutation({
    mutationFn: ({ figureId, file }: { figureId: string; file: File; caseId: string }) =>
      workbenchApi.uploadFigureImage(figureId, file),
    onSuccess: (_data, variables) => client.invalidateQueries({ queryKey: workbenchKeys.figures(variables.caseId) }),
  })
  const addReleaseItem = useMutation({
    mutationFn: ({ releaseId, item }: { releaseId: string; item: { item_kind: 'document' | 'figure'; revision_id: string; ordinal?: number }; caseId: string }) =>
      workbenchApi.addReleaseItem(releaseId, item),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: workbenchKeys.releaseItems(variables.releaseId) })
      void client.invalidateQueries({ queryKey: workbenchKeys.releases(variables.caseId) })
    },
  })
  const buildRelease = useMutation({
    mutationFn: ({ releaseId }: { releaseId: string; caseId: string }) => workbenchApi.buildRelease(releaseId),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: workbenchKeys.releaseArtifacts(variables.releaseId) })
      void client.invalidateQueries({ queryKey: workbenchKeys.releases(variables.caseId) })
    },
  })
  const setWorkItemDeadline = useMutation({
    mutationFn: ({ workItemId, deadline }: { workItemId: string; deadline: string | null; caseId: string }) =>
      workbenchApi.setWorkItemDeadline(workItemId, deadline),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: workbenchKeys.caseWorkItems(variables.caseId) })
      void client.invalidateQueries({ queryKey: workbenchKeys.workItems() })
    },
  })
  const addParticipant = useMutation({
    mutationFn: ({ caseId, principalId, role }: { caseId: string; principalId: string; role: ParticipantRole }) =>
      workbenchApi.addParticipant(caseId, principalId, role),
    onSuccess: (_data, variables) => client.invalidateQueries({ queryKey: workbenchKeys.participants(variables.caseId) }),
  })
  const invite = useMutation({
    mutationFn: ({ organizationId, inviteePrincipalId, role, caseId, expiresAt }:
      { organizationId: string; inviteePrincipalId: string; role: InvitationRole; caseId: string | null; expiresAt: string }) =>
      workbenchApi.invite(organizationId, inviteePrincipalId, role, caseId, expiresAt),
    onSuccess: (_data, variables) => client.invalidateQueries({ queryKey: workbenchKeys.memberships(variables.organizationId) }),
  })
  return { decideApproval, setWorkItemStatus, decideProposal, markNotificationRead, createDocument, createRelease, sealRelease, addReleaseItem, buildRelease, createFigure, uploadFigureImage, setWorkItemDeadline, addParticipant, invite }
}
