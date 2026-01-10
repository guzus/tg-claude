"use client";

import { useState } from "react";
import { Header } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  FolderTree,
  MessageSquare,
  Save,
  ChevronRight,
  File,
  Folder,
  Edit3,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ContextFile {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  children?: ContextFile[];
  content?: string;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// Mock data for demonstration
const mockHierarchy: ContextFile[] = [
  {
    id: "1",
    name: "CLAUDE.md",
    path: "/CLAUDE.md",
    type: "file",
    content: `# Project Guidelines

1. Keep code focused and clean
2. Use TypeScript for type safety
3. Follow DRY principles
4. Run lint before commit`,
  },
  {
    id: "2",
    name: "src",
    path: "/src",
    type: "folder",
    children: [
      { id: "2.1", name: "index.ts", path: "/src/index.ts", type: "file" },
      { id: "2.2", name: "types.ts", path: "/src/types.ts", type: "file" },
      {
        id: "2.3",
        name: "services",
        path: "/src/services",
        type: "folder",
        children: [
          { id: "2.3.1", name: "executor.ts", path: "/src/services/executor.ts", type: "file" },
        ],
      },
    ],
  },
  {
    id: "3",
    name: "docs",
    path: "/docs",
    type: "folder",
    children: [
      { id: "3.1", name: "API.md", path: "/docs/API.md", type: "file" },
      { id: "3.2", name: "SETUP.md", path: "/docs/SETUP.md", type: "file" },
    ],
  },
];

const mockConversation: ConversationMessage[] = [
  { role: "user", content: "Help me refactor the executor service", timestamp: "2 min ago" },
  {
    role: "assistant",
    content: "I'll help you refactor the executor service. Let me first analyze the current implementation...",
    timestamp: "1 min ago",
  },
];

export default function ContextPage() {
  const [selectedFile, setSelectedFile] = useState<ContextFile | null>(null);
  const [claudeMd, setClaudeMd] = useState(mockHierarchy[0].content || "");
  const [isEditing, setIsEditing] = useState(false);

  return (
    <>
      <Header
        title="Context"
        description="Manage project context, hierarchy, and documentation"
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-72 border-r flex flex-col">
          <Tabs defaultValue="hierarchy" className="flex-1 flex flex-col">
            <div className="px-4 pt-4">
              <TabsList className="w-full">
                <TabsTrigger value="hierarchy" className="flex-1 gap-1.5">
                  <FolderTree className="w-3 h-3" />
                  Files
                </TabsTrigger>
                <TabsTrigger value="docs" className="flex-1 gap-1.5">
                  <BookOpen className="w-3 h-3" />
                  Docs
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="hierarchy" className="flex-1 mt-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4">
                  <FileTree
                    items={mockHierarchy}
                    selectedId={selectedFile?.id}
                    onSelect={setSelectedFile}
                  />
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="docs" className="flex-1 mt-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-2">
                  <DocItem
                    title="CLAUDE.md"
                    description="Project guidelines"
                    icon={FileText}
                    onClick={() => setSelectedFile(mockHierarchy[0])}
                    selected={selectedFile?.name === "CLAUDE.md"}
                  />
                  <DocItem
                    title="API Reference"
                    description="Endpoint documentation"
                    icon={BookOpen}
                  />
                  <DocItem
                    title="Setup Guide"
                    description="Installation steps"
                    icon={BookOpen}
                  />
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Tabs defaultValue="editor" className="flex-1 flex flex-col">
            <div className="px-6 pt-4 border-b">
              <TabsList>
                <TabsTrigger value="editor" className="gap-1.5">
                  <Edit3 className="w-3 h-3" />
                  Editor
                </TabsTrigger>
                <TabsTrigger value="conversation" className="gap-1.5">
                  <MessageSquare className="w-3 h-3" />
                  Conversation
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="editor" className="flex-1 mt-0 overflow-hidden">
              {selectedFile?.type === "file" ? (
                <FileEditor
                  file={selectedFile}
                  content={selectedFile.name === "CLAUDE.md" ? claudeMd : ""}
                  isEditing={isEditing}
                  onEdit={() => setIsEditing(true)}
                  onSave={(content) => {
                    if (selectedFile.name === "CLAUDE.md") {
                      setClaudeMd(content);
                    }
                    setIsEditing(false);
                  }}
                  onCancel={() => setIsEditing(false)}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <FileText className="w-16 h-16 mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-medium">Select a file to view</p>
                    <p className="text-sm mt-1">Browse the file tree to select a file</p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="conversation" className="flex-1 mt-0 overflow-hidden">
              <ConversationView messages={mockConversation} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}

function FileTree({
  items,
  selectedId,
  onSelect,
  level = 0,
}: {
  items: ContextFile[];
  selectedId?: string;
  onSelect: (file: ContextFile) => void;
  level?: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["2", "2.3", "3"]));

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpanded(next);
  };

  return (
    <div className="space-y-0.5">
      {items.map((item) => (
        <div key={item.id}>
          <button
            onClick={() => {
              if (item.type === "folder") {
                toggle(item.id);
              } else {
                onSelect(item);
              }
            }}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
              selectedId === item.id
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-foreground"
            )}
            style={{ paddingLeft: `${level * 12 + 8}px` }}
          >
            {item.type === "folder" ? (
              <>
                <ChevronRight
                  className={cn(
                    "w-3 h-3 shrink-0 transition-transform",
                    expanded.has(item.id) && "rotate-90"
                  )}
                />
                <Folder className="w-4 h-4 shrink-0 text-amber-500" />
              </>
            ) : (
              <>
                <span className="w-3" />
                <File className="w-4 h-4 shrink-0 text-muted-foreground" />
              </>
            )}
            <span className="truncate">{item.name}</span>
          </button>
          {item.type === "folder" && item.children && expanded.has(item.id) && (
            <FileTree
              items={item.children}
              selectedId={selectedId}
              onSelect={onSelect}
              level={level + 1}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function DocItem({
  title,
  description,
  icon: Icon,
  onClick,
  selected,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  onClick?: () => void;
  selected?: boolean;
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
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="font-medium text-sm">{title}</p>
          <p className={cn("text-xs mt-0.5", selected ? "opacity-80" : "text-muted-foreground")}>
            {description}
          </p>
        </div>
      </div>
    </button>
  );
}

function FileEditor({
  file,
  content,
  isEditing,
  onEdit,
  onSave,
  onCancel,
}: {
  file: ContextFile;
  content: string;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [editContent, setEditContent] = useState(content);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">{file.name}</span>
          <span className="text-xs text-muted-foreground">{file.path}</span>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => onSave(editContent)}>
                <Save className="w-4 h-4 mr-1.5" />
                Save
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Edit3 className="w-4 h-4 mr-1.5" />
              Edit
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {isEditing ? (
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="h-full w-full resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0"
          />
        ) : (
          <ScrollArea className="h-full">
            <pre className="p-6 text-sm font-mono whitespace-pre-wrap">{content || file.content}</pre>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

function ConversationView({ messages }: { messages: ConversationMessage[] }) {
  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-4 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">Conversation History</h3>
          <Badge variant="secondary">{messages.length} messages</Badge>
        </div>
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "p-4 rounded-lg",
              msg.role === "user" ? "bg-muted ml-8" : "bg-primary/5 mr-8"
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={msg.role === "user" ? "secondary" : "default"}>
                {msg.role}
              </Badge>
              <span className="text-xs text-muted-foreground">{msg.timestamp}</span>
            </div>
            <p className="text-sm">{msg.content}</p>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
