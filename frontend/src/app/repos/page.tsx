"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  FolderGit2,
  GitBranch,
  Plus,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Search,
  X,
  Download,
  Folder,
} from "lucide-react";
import { api, type Repository } from "@/lib/api";
import { formatDate, cn, truncate } from "@/lib/utils";

// Default user ID for guests (not logged in)
const GUEST_USER_ID = 1;

export default function ReposPage() {
  const { data: session } = useSession();
  const userId = (session?.user as { numericId?: number })?.numericId ?? GUEST_USER_ID;
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchRepos = async () => {
      try {
        const data = await api.getRepositories(userId);
        setRepos(data);
      } catch (error) {
        console.error("Failed to fetch repos:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchRepos();
  }, [userId]);

  const filteredRepos = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.gitUrl?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const clonedRepos = filteredRepos.filter((r) => r.type === "cloned");

  return (
    <>
      <Header
        title="Repositories"
        description="Manage your project repositories"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowCloneModal(true)}>
              <Download className="w-4 h-4 mr-1.5" />
              Clone
            </Button>
            <Button size="sm" onClick={() => setShowNewModal(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              New
            </Button>
          </div>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Repo List */}
        <div className="w-80 border-r flex flex-col">
          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <Tabs defaultValue="all" className="flex-1 flex flex-col">
            <div className="px-4">
              <TabsList className="w-full">
                <TabsTrigger value="all" className="flex-1">
                  All ({filteredRepos.length})
                </TabsTrigger>
                <TabsTrigger value="cloned" className="flex-1">
                  Cloned ({clonedRepos.length})
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="all" className="flex-1 mt-0">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-2">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredRepos.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No repositories found
                    </div>
                  ) : (
                    filteredRepos.map((repo) => (
                      <RepoListItem
                        key={repo.id}
                        repo={repo}
                        selected={selectedRepo?.id === repo.id}
                        onClick={() => setSelectedRepo(repo)}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="cloned" className="flex-1 mt-0">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-2">
                  {clonedRepos.map((repo) => (
                    <RepoListItem
                      key={repo.id}
                      repo={repo}
                      selected={selectedRepo?.id === repo.id}
                      onClick={() => setSelectedRepo(repo)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        {/* Repo Detail */}
        <div className="flex-1 overflow-hidden">
          {selectedRepo ? (
            <RepoDetail userId={userId} repo={selectedRepo} />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <FolderGit2 className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">Select a repository</p>
                <p className="text-sm mt-1">View details and manage settings</p>
              </div>
            </div>
          )}
        </div>

        {/* Modals */}
        {showCloneModal && <CloneModal userId={userId} onClose={() => setShowCloneModal(false)} />}
        {showNewModal && <NewRepoModal userId={userId} onClose={() => setShowNewModal(false)} />}
      </div>
    </>
  );
}

function RepoListItem({
  repo,
  selected,
  onClick,
}: {
  repo: Repository;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg transition-colors",
        selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("p-2 rounded-lg", selected ? "bg-primary-foreground/10" : "bg-muted")}>
          {repo.type === "cloned" ? (
            <FolderGit2 className="w-4 h-4" />
          ) : (
            <Folder className="w-4 h-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{repo.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {repo.branch && (
              <span className={cn("text-xs flex items-center gap-1", selected ? "opacity-80" : "text-muted-foreground")}>
                <GitBranch className="w-3 h-3" />
                {repo.branch}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function RepoDetail({ userId, repo }: { userId: number; repo: Repository }) {
  const handleSwitch = async () => {
    try {
      await api.switchRepository(userId, repo.id);
    } catch (error) {
      console.error("Failed to switch repo:", error);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-3 rounded-lg bg-muted">
                <FolderGit2 className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">{repo.name}</h2>
                <Badge variant="secondary" className="mt-1">
                  {repo.type}
                </Badge>
              </div>
            </div>
          </div>
          <Button onClick={handleSwitch}>
            <CheckCircle2 className="w-4 h-4 mr-1.5" />
            Set Active
          </Button>
        </div>

        <Separator />

        {/* Info */}
        <div className="grid gap-4">
          <InfoRow label="Path" value={repo.path} mono />
          {repo.gitUrl && (
            <InfoRow
              label="Git URL"
              value={
                <a
                  href={repo.gitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline flex items-center gap-1"
                >
                  {truncate(repo.gitUrl, 50)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              }
            />
          )}
          {repo.branch && <InfoRow label="Branch" value={repo.branch} />}
          <InfoRow label="Created" value={formatDate(repo.createdAt)} />
          <InfoRow label="Last Used" value={formatDate(repo.lastUsed)} />
        </div>

        <Separator />

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
            <CardDescription>Common operations for this repository</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="justify-start">
              <GitBranch className="w-4 h-4 mr-2" />
              Switch Branch
            </Button>
            <Button variant="outline" className="justify-start">
              <Download className="w-4 h-4 mr-2" />
              Pull Latest
            </Button>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-sm text-right", mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}

function CloneModal({ userId, onClose }: { userId: number; onClose: () => void }) {
  const [gitUrl, setGitUrl] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gitUrl.trim()) return;

    setLoading(true);
    try {
      await api.cloneRepository(userId, gitUrl, name || undefined, branch || undefined);
      onClose();
    } catch (error) {
      console.error("Failed to clone:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Clone Repository</CardTitle>
            <CardDescription>Clone a git repository</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Git URL *</label>
              <Input
                placeholder="https://github.com/user/repo.git"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Name (optional)</label>
              <Input
                placeholder="my-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Branch (optional)</label>
              <Input
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!gitUrl.trim() || loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Clone
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function NewRepoModal({ userId, onClose }: { userId: number; onClose: () => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      await api.createRepository(userId, name);
      onClose();
    } catch (error) {
      console.error("Failed to create:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>New Repository</CardTitle>
            <CardDescription>Create a new local repository</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Name *</label>
              <Input
                placeholder="my-new-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
