#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec, ExecException } from 'child_process';

interface SystemInfo {
  platform: string;
  arch: string;
  cpus: os.CpuInfo[];
  totalMem: number;
  freeMem: number;
  uptime: number;
  loadavg: number[];
  networkInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
}

const server = new Server(
  {
    name: "EverythingServer",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_file",
        description: "Read contents of a file",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file"
            }
          },
          required: ["path"]
        }
      },
      {
        name: "write_file",
        description: "Write content to a file",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to write the file"
            },
            content: {
              type: "string",
              description: "Content to write"
            }
          },
          required: ["path", "content"]
        }
      },
      {
        name: "list_directory",
        description: "List contents of a directory",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Directory path"
            },
            recursive: {
              type: "boolean",
              description: "Whether to list recursively"
            }
          },
          required: ["path"]
        }
      },
      {
        name: "system_info",
        description: "Get system information",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "http_request",
        description: "Make an HTTP request",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL to request"
            },
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "DELETE"],
              default: "GET"
            },
            headers: {
              type: "object",
              description: "Request headers"
            },
            body: {
              type: "string",
              description: "Request body"
            }
          },
          required: ["url"]
        }
      },
      {
        name: "run_command",
        description: "Execute a system command",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Command to execute"
            },
            cwd: {
              type: "string",
              description: "Working directory"
            }
          },
          required: ["command"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "read_file": {
        const filePath = String(request.params.arguments?.path);
        const content = await fs.readFile(filePath, 'utf-8');
        return {
          content: [{
            type: "text",
            text: content
          }]
        };
      }

      case "write_file": {
        const filePath = String(request.params.arguments?.path);
        const content = String(request.params.arguments?.content);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        return {
          content: [{
            type: "text",
            text: `File written successfully: ${filePath}`
          }]
        };
      }

      case "list_directory": {
        const dirPath = String(request.params.arguments?.path);
        const recursive = Boolean(request.params.arguments?.recursive);
        
        async function listDir(dir: string): Promise<string[]> {
          const items = await fs.readdir(dir, { withFileTypes: true });
          const files: string[] = [];
          
          for (const item of items) {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory() && recursive) {
              files.push(...await listDir(fullPath));
            } else {
              files.push(fullPath);
            }
          }
          
          return files;
        }

        const files = await listDir(dirPath);
        return {
          content: [{
            type: "text",
            text: files.join('\n')
          }]
        };
      }

      case "system_info": {
        const info: SystemInfo = {
          platform: os.platform(),
          arch: os.arch(),
          cpus: os.cpus(),
          totalMem: os.totalmem(),
          freeMem: os.freemem(),
          uptime: os.uptime(),
          loadavg: os.loadavg(),
          networkInterfaces: os.networkInterfaces()
        };
        return {
          content: [{
            type: "text",
            text: JSON.stringify(info, null, 2)
          }]
        };
      }

      case "http_request": {
        const url = String(request.params.arguments?.url);
        const method = String(request.params.arguments?.method || 'GET');
        const headers = request.params.arguments?.headers as Record<string, string> || {};
        const body = request.params.arguments?.body as string | undefined;

        const response = await fetch(url, {
          method,
          headers,
          body: body || null,
        });

        const data = await response.text();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: response.status,
              headers: Object.fromEntries(response.headers.entries()),
              data: data
            }, null, 2)
          }]
        };
      }

      case "run_command": {
        const command = String(request.params.arguments?.command);
        const cwd = request.params.arguments?.cwd as string | undefined;

        return new Promise((resolve) => {
          exec(command, { cwd }, (error: ExecException | null, stdout: string, stderr: string) => {
            resolve({
              content: [{
                type: "text",
                text: error ? `Error: ${error.message}\n${stderr}` : stdout
              }]
            });
          });
        });
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    throw new McpError(ErrorCode.InternalError, String(error));
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Everything MCP server running on stdio');
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});