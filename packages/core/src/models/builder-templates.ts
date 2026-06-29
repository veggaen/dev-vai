/**
 * builder-templates — pure, standalone "build me an X" response templates.
 *
 * Extracted verbatim from VaiEngine (vai-engine.ts) where they lived as private
 * methods with ZERO this/super coupling: pure string builders that, given a
 * description, return a fixed markdown answer. Kept byte-identical to the originals
 * (proven by the golden capture). VaiEngine now delegates to these via thin wrappers,
 * shrinking the god-class by ~4.8k lines.
 */
/* eslint-disable */

export function generateBuilderNextjsClarifier(): string {
    return 'Do you want a fresh Next.js starter, or do you want a custom Next.js app built directly? If you want the starter, reply with "fresh Next.js starter". Otherwise describe the app and I will build it without falling back to a template.';
  }

export function generateBuilderGenericAppClarifier(): string {
    return [
      'I can build something much stronger than a toy starter, but `good app` is still too open to guess honestly.',
      '',
      'Reply with one line in this format:',
      '`audience + main action + vibe`',
      '',
      'Examples:',
      '- `solo founders + track launches + premium dark workspace`',
      '- `photographers + book clients + elegant editorial site`',
      '- `roommates + coordinate groceries + fast mobile-first app`',
      '- `small team + manage approvals + clean internal dashboard`',
    ].join('\n');
  }

export function generateBuilderRustApp(desc: string): string {
    const isCli = /\bcli\b|\bcommand[\s-]?line\b|\btool\b/i.test(desc);
    const isWeb = /\bweb\b|\bapi\b|\bserver\b|\bhttp\b/i.test(desc);
    const appDesc = desc.replace(/\bbuild\b|\bcreate\b|\bmake\b/gi, '').trim() || 'rust cli tool';

    if (isCli && /\b(?:incident|triage|severity|sev|on[\s-]?call|runbook)\b/i.test(desc)) {
      return [
        'Building a Rust CLI incident triage tool with Clap commands.',
        '',
        '```toml title="Cargo.toml"',
        '[package]',
        'name = "incident-triage"',
        'version = "0.1.0"',
        'edition = "2021"',
        '',
        '[dependencies]',
        'clap = { version = "4", features = ["derive"] }',
        '```',
        '',
        '```rust title="src/main.rs"',
        'use clap::{Parser, Subcommand};',
        '',
        '#[derive(Parser)]',
        '#[command(name = "incident-triage", about = "Rust CLI incident triage tool", version)]',
        'struct Cli {',
        '    #[command(subcommand)]',
        '    command: Commands,',
        '}',
        '',
        '#[derive(Subcommand)]',
        'enum Commands {',
        '    /// List active incidents by severity and owner',
        '    List,',
        '    /// Show one incident by id',
        '    Show { id: u32 },',
        '    /// Escalate an incident to a new owner',
        '    Escalate { id: u32, owner: String },',
        '    /// Print severity counts for the current queue',
        '    Summary,',
        '}',
        '',
        '#[derive(Clone)]',
        'struct Incident {',
        '    id: u32,',
        "    title: &'static str,",
        "    severity: &'static str,",
        "    owner: &'static str,",
        "    status: &'static str,",
        '}',
        '',
        'fn seeded_incidents() -> Vec<Incident> {',
        '    vec![',
        '        Incident { id: 101, title: "API latency spike", severity: "sev2", owner: "platform", status: "investigating" },',
        '        Incident { id: 102, title: "Checkout webhooks delayed", severity: "sev1", owner: "payments", status: "escalated" },',
        '        Incident { id: 103, title: "Search index lag", severity: "sev3", owner: "search", status: "monitoring" },',
        '    ]',
        '}',
        '',
        'fn main() {',
        '    let cli = Cli::parse();',
        '    let incidents = seeded_incidents();',
        '',
        '    match cli.command {',
        '        Commands::List => {',
        '            println!("Rust CLI active incident triage queue:");',
        '            for incident in &incidents {',
        '                println!("[{}] {} | severity={} | owner={} | status={}", incident.id, incident.title, incident.severity, incident.owner, incident.status);',
        '            }',
        '        }',
        '        Commands::Show { id } => {',
        '            match incidents.iter().find(|incident| incident.id == id) {',
        '                Some(incident) => println!("Incident {}: {}\\nseverity: {}\\nowner: {}\\nstatus: {}", incident.id, incident.title, incident.severity, incident.owner, incident.status),',
        '                None => eprintln!("No incident found for id {id}"),',
        '            }',
        '        }',
        '        Commands::Escalate { id, owner } => {',
        '            match incidents.iter().find(|incident| incident.id == id) {',
        '                Some(incident) => println!("Escalating incident {} ({}) from {} to {}", incident.id, incident.title, incident.owner, owner),',
        '                None => eprintln!("No incident found for id {id}"),',
        '            }',
        '        }',
        '        Commands::Summary => {',
        '            let sev1 = incidents.iter().filter(|incident| incident.severity == "sev1").count();',
        '            let sev2 = incidents.iter().filter(|incident| incident.severity == "sev2").count();',
        '            let sev3 = incidents.iter().filter(|incident| incident.severity == "sev3").count();',
        '            println!("Incident summary: sev1={sev1}, sev2={sev2}, sev3={sev3}");',
        '        }',
        '    }',
        '}',
        '```',
        '',
        '**Run:** `cargo run -- list`, `cargo run -- show 102`, `cargo run -- escalate 102 oncall-lead`, or `cargo run -- summary`',
        '**What to check:** the CLI prints incident ids, severity, owner, status, and escalation output instead of a generic greeting demo.',
      ].join('\n');
    }

    if (isWeb) {
      return (
        'Building a Rust web API with Axum.\n\n' +
        '```toml title="Cargo.toml"\n' +
        '[package]\nname = "rust-api"\nversion = "0.1.0"\nedition = "2021"\n\n' +
        '[dependencies]\naxum = "0.7"\ntokio = { version = "1", features = ["full"] }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n' +
        '```\n\n' +
        '```rust title="src/main.rs"\n' +
        'use axum::{\n    routing::{get, post},\n    Json, Router,\n};\n' +
        'use serde::{Deserialize, Serialize};\n\n' +
        '#[derive(Serialize, Deserialize, Clone)]\nstruct Item {\n    id: u32,\n    name: String,\n}\n\n' +
        'async fn list_items() -> Json<Vec<Item>> {\n    Json(vec![\n        Item { id: 1, name: "foo".into() },\n        Item { id: 2, name: "bar".into() },\n    ])\n}\n\n' +
        'async fn health() -> &\'static str { "ok" }\n\n' +
        '#[tokio::main]\nasync fn main() {\n    let app = Router::new()\n        .route("/health", get(health))\n        .route("/items", get(list_items));\n    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();\n    println!("Listening on http://localhost:3000");\n    axum::serve(listener, app).await.unwrap();\n}\n' +
        '```\n\n' +
        '**Run:** `cargo run` → http://localhost:3000/health\n' +
        '**What to check:** GET /items returns JSON array.'
      );
    }

    return (
      `Building a Rust CLI — ${appDesc}.\n\n` +
      '```toml title="Cargo.toml"\n' +
      '[package]\nname = "rust-cli"\nversion = "0.1.0"\nedition = "2021"\n\n' +
      '[dependencies]\nclap = { version = "4", features = ["derive"] }\n' +
      '```\n\n' +
      '```rust title="src/main.rs"\n' +
      'use clap::{Parser, Subcommand};\n\n' +
      '#[derive(Parser)]\n#[command(name = "cli", about = "A Rust CLI tool", version)]\nstruct Cli {\n    #[command(subcommand)]\n    command: Commands,\n}\n\n' +
      '#[derive(Subcommand)]\nenum Commands {\n    /// Greet someone\n    Greet {\n        /// Name to greet\n        name: String,\n        /// Greet loudly\n        #[arg(short, long)]\n        loud: bool,\n    },\n    /// Show version info\n    Info,\n}\n\n' +
      'fn main() {\n    let cli = Cli::parse();\n    match cli.command {\n        Commands::Greet { name, loud } => {\n            let msg = format!("Hello, {}!", name);\n            println!("{}", if loud { msg.to_uppercase() } else { msg });\n        }\n        Commands::Info => println!("rust-cli v0.1.0 — built with Clap 4"),\n    }\n}\n' +
      '```\n\n' +
      '**Run:** `cargo run -- greet World` or `cargo run -- greet World --loud`\n' +
      '**What to check:** prints a normal or uppercase greeting, and `cargo run -- info` prints the version banner.'
    );
  }

export function generateBuilderCSharpApp(desc: string): string {
    const isApi = /\bapi\b|\bweb\b|\bhttp\b|\bserver\b/i.test(desc);
    const appDesc = desc.replace(/\bbuild\b|\bcreate\b|\bmake\b/gi, '').trim() || 'console tool';

    if (isApi) {
      return (
        'Building a C# minimal API with ASP.NET Core.\n\n' +
        '```xml title="App.csproj"\n' +
        '<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n</Project>\n' +
        '```\n\n' +
        '```csharp title="Program.cs"\n' +
        'var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\n\nvar todos = new List<Todo>();\nvar nextId = 1;\n\napp.MapGet("/health", () => new { status = "ok" });\napp.MapGet("/todos", () => todos);\napp.MapPost("/todos", (TodoInput input) => {\n    var todo = new Todo(nextId++, input.Text, false);\n    todos.Add(todo);\n    return Results.Created($"/todos/{todo.Id}", todo);\n});\napp.MapPatch("/todos/{id}", (int id) => {\n    var todo = todos.FirstOrDefault(t => t.Id == id);\n    if (todo is null) return Results.NotFound();\n    todos[todos.IndexOf(todo)] = todo with { Done = !todo.Done };\n    return Results.Ok();\n});\n\napp.Run();\n\nrecord Todo(int Id, string Text, bool Done);\nrecord TodoInput(string Text);\n' +
        '```\n\n' +
        '**Run:** `dotnet run` → http://localhost:5000\n' +
        '**What to check:** POST /todos with `{"text":"buy milk"}`, GET /todos returns the list.'
      );
    }

    return (
      `Building a C# console app — ${appDesc}.\n\n` +
      '```xml title="App.csproj"\n' +
      '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net8.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n</Project>\n' +
      '```\n\n' +
      '```csharp title="Program.cs"\n' +
      'using System.Collections.Generic;\n\nConsole.WriteLine("=== Todo Manager ===");\nvar todos = new List<(int id, string text, bool done)>();\nvar id = 1;\n\nwhile (true) {\n    Console.Write("\\n[a]dd [l]ist [d]one [q]uit > ");\n    var cmd = Console.ReadLine()?.Trim().ToLower();\n    switch (cmd) {\n        case "a":\n            Console.Write("Todo: ");\n            var text = Console.ReadLine() ?? "";\n            if (!string.IsNullOrWhiteSpace(text)) todos.Add((id++, text, false));\n            break;\n        case "l":\n            if (todos.Count == 0) { Console.WriteLine("No todos."); break; }\n            foreach (var t in todos)\n                Console.WriteLine($"  [{(t.done ? "x" : " ")}] {t.id}. {t.text}");\n            break;\n        case "d":\n            Console.Write("ID to toggle: ");\n            if (int.TryParse(Console.ReadLine(), out var tid)) {\n                var idx = todos.FindIndex(t => t.id == tid);\n                if (idx >= 0) todos[idx] = todos[idx] with { done = !todos[idx].done };\n            }\n            break;\n        case "q": return;\n    }\n}\n' +
      '```\n\n' +
      '**Run:** `dotnet run`\n' +
      '**What to check:** Add todos with `a`, list with `l`, toggle done with `d`.'
    );
  }

export function generateBuilderCppApp(desc: string): string {
    const isDs = /\blinked\s*list\b|\bstack\b|\bqueue\b|\btree\b|\bgraph\b/i.test(desc);
    const appDesc = desc.replace(/\bbuild\b|\bcreate\b|\bmake\b/gi, '').trim() || 'cli tool';

    if (isDs) {
      return (
        'Building a C++ linked list implementation.\n\n' +
        '```cpp title="main.cpp"\n' +
        '#include <iostream>\n#include <memory>\n\ntemplate<typename T>\nstruct Node {\n    T value;\n    std::unique_ptr<Node<T>> next;\n    explicit Node(T v) : value(std::move(v)), next(nullptr) {}\n};\n\ntemplate<typename T>\nclass LinkedList {\n    std::unique_ptr<Node<T>> head;\n    size_t _size = 0;\npublic:\n    void push_front(T val) {\n        auto node = std::make_unique<Node<T>>(std::move(val));\n        node->next = std::move(head);\n        head = std::move(node);\n        ++_size;\n    }\n    void print() const {\n        auto* cur = head.get();\n        while (cur) { std::cout << cur->value << " -> "; cur = cur->next.get(); }\n        std::cout << "null\\n";\n    }\n    size_t size() const { return _size; }\n};\n\nint main() {\n    LinkedList<int> list;\n    list.push_front(3);\n    list.push_front(2);\n    list.push_front(1);\n    std::cout << "List: "; list.print();\n    std::cout << "Size: " << list.size() << "\\n";\n    return 0;\n}\n' +
        '```\n\n' +
        '```cmake title="CMakeLists.txt"\n' +
        'cmake_minimum_required(VERSION 3.20)\nproject(cpp-app)\nset(CMAKE_CXX_STANDARD 20)\nadd_executable(app main.cpp)\n' +
        '```\n\n' +
        '**Build:** `cmake -B build && cmake --build build && ./build/app`\n' +
        '**What to check:** prints `1 -> 2 -> 3 -> null` and `Size: 3`.'
      );
    }

    return (
      `Building a C++ CLI app — ${appDesc}.\n\n` +
      '```cpp title="main.cpp"\n' +
      '#include <iostream>\n#include <string>\n#include <vector>\n#include <algorithm>\n\nstruct Todo {\n    int id;\n    std::string text;\n    bool done = false;\n};\n\nvoid printList(const std::vector<Todo>& todos) {\n    if (todos.empty()) { std::cout << "  (empty)\\n"; return; }\n    for (const auto& t : todos)\n        std::cout << "  [" << (t.done ? "x" : " ") << "] " << t.id << ". " << t.text << "\\n";\n}\n\nint main() {\n    std::vector<Todo> todos;\n    int nextId = 1;\n    std::string cmd;\n    std::cout << "=== C++ Todo ===\\n";\n    while (true) {\n        std::cout << "\\n[a]dd [l]ist [d]one [q]uit > ";\n        std::cin >> cmd;\n        std::cin.ignore();\n        if (cmd == "a") {\n            std::cout << "Todo: "; std::string text; std::getline(std::cin, text);\n            if (!text.empty()) todos.push_back({nextId++, text, false});\n        } else if (cmd == "l") {\n            printList(todos);\n        } else if (cmd == "d") {\n            std::cout << "ID: "; int id; std::cin >> id; std::cin.ignore();\n            auto it = std::find_if(todos.begin(), todos.end(), [id](auto& t){ return t.id == id; });\n            if (it != todos.end()) it->done = !it->done;\n        } else if (cmd == "q") { break; }\n    }\n    return 0;\n}\n' +
      '```\n\n' +
      '```cmake title="CMakeLists.txt"\n' +
      'cmake_minimum_required(VERSION 3.20)\nproject(cpp-todo)\nset(CMAKE_CXX_STANDARD 20)\nadd_executable(todo main.cpp)\n' +
      '```\n\n' +
      '**Build:** `cmake -B build && cmake --build build && ./build/todo`\n' +
      '**What to check:** `a` to add, `l` to list, `d` to toggle done.'
    );
  }

export function generateBuilderViteApp(desc: string): string {
    const isTs = /\btypescript\b|\bts\b/i.test(desc);
    const isTailwind = /\btailwind\b/i.test(desc);
    const appName = 'vite-app';

    const pkg = JSON.stringify({
      name: appName,
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: { dev: 'vite', build: isTs ? 'tsc -b && vite build' : 'vite build', preview: 'vite preview' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: {
        ...(isTs ? { '@types/react': '^18.3.1', '@types/react-dom': '^18.3.1', typescript: '^5.5.3', } : {}),
        '@vitejs/plugin-react': '^4.3.1',
        vite: '^5.4.10',
        ...(isTailwind ? { tailwindcss: '^3.4.4', autoprefixer: '^10.4.19', postcss: '^8.4.38' } : {}),
      },
    }, null, 2);

    const ext = isTs ? 'tsx' : 'jsx';
    const cssContent = isTailwind
      ? '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n'
      : 'body { margin: 0; font-family: Inter, sans-serif; background: #f9fafb; }\n.app { max-width: 600px; margin: 40px auto; padding: 0 16px; }\n';

    return (
      `Building a Vite + React${isTs ? ' + TypeScript' : ''}${isTailwind ? ' + Tailwind' : ''} app.\n\n` +
      `\`\`\`json title="package.json"\n${pkg}\n\`\`\`\n\n` +
      `\`\`\`html title="index.html"\n<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Vite App</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.${ext}"></script>\n  </body>\n</html>\n\`\`\`\n\n` +
      `\`\`\`${ext} title="src/main.${ext}"\nimport { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport './index.css'\nimport App from './App.${ext}'\ncreateRoot(document.getElementById('root')${isTs ? '!' : ''}).render(<StrictMode><App /></StrictMode>)\n\`\`\`\n\n` +
      `\`\`\`${ext} title="src/App.${ext}"\nimport { useState } from 'react'\n\nexport default function App() {\n  const [count, setCount] = useState(0)\n  return (\n    <div className="app">\n      <h1>Vite + React</h1>\n      <button onClick={() => setCount(c => c + 1)}>count is {count}</button>\n    </div>\n  )\n}\n\`\`\`\n\n` +
      `\`\`\`css title="src/index.css"\n${cssContent}\`\`\`\n\n` +
      `\`\`\`${isTs ? 'ts' : 'js'} title="vite.config.${isTs ? 'ts' : 'js'}"\nimport { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n\`\`\`\n\n` +
      (isTs ? `\`\`\`json title="tsconfig.json"\n{\n  "compilerOptions": {\n    "target": "ES2020",\n    "lib": ["ES2020", "DOM", "DOM.Iterable"],\n    "module": "ESNext",\n    "moduleResolution": "bundler",\n    "allowImportingTsExtensions": true,\n    "noEmit": true,\n    "jsx": "react-jsx",\n    "strict": true,\n    "skipLibCheck": true\n  },\n  "include": ["src"]\n}\n\`\`\`\n\n` : '') +
      '**Run:** `npm install && npm run dev` → http://localhost:5173\n' +
      '**What to check:** Click the button, count increments.'
    );
  }

export function generateBuilderNodeExpressApp(desc: string): string {
    const isCrud = /\bcrud\b|\btodo\b|\bapi\b|\brest\b/i.test(desc);
    const appDesc = desc.replace(/\bbuild\b|\bcreate\b|\bmake\b/gi, '').trim() || 'express api';

    const pkg = JSON.stringify({
      name: 'node-api',
      version: '1.0.0',
      main: 'src/index.js',
      type: 'module',
      scripts: { start: 'node src/index.js', dev: 'node --watch src/index.js' },
      dependencies: { express: '^4.21.0' },
    }, null, 2);

    const mainCode = isCrud
      ? `import express from 'express';\n\nconst app = express();\napp.use(express.json());\n\nconst items = new Map();\nlet nextId = 1;\n\napp.get('/health', (_req, res) => res.json({ status: 'ok' }));\n\napp.get('/items', (_req, res) => res.json([...items.values()]));\n\napp.post('/items', (req, res) => {\n  const { name } = req.body;\n  if (!name) return res.status(400).json({ error: 'name required' });\n  const item = { id: nextId++, name, done: false };\n  items.set(item.id, item);\n  res.status(201).json(item);\n});\n\napp.patch('/items/:id', (req, res) => {\n  const id = Number(req.params.id);\n  const item = items.get(id);\n  if (!item) return res.status(404).json({ error: 'not found' });\n  items.set(id, { ...item, done: !item.done });\n  res.json(items.get(id));\n});\n\napp.delete('/items/:id', (req, res) => {\n  const id = Number(req.params.id);\n  if (!items.delete(id)) return res.status(404).json({ error: 'not found' });\n  res.status(204).end();\n});\n\nconst PORT = process.env.PORT ?? 3000;\napp.listen(PORT, () => console.log(\`Server running on http://localhost:\${PORT}\`));\n`
      : `import express from 'express';\n\nconst app = express();\napp.use(express.json());\n\napp.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));\n\napp.get('/hello/:name', (req, res) => {\n  res.json({ message: \`Hello, \${req.params.name}!\` });\n});\n\napp.use((err, _req, res, _next) => {\n  console.error(err);\n  res.status(500).json({ error: 'Internal server error' });\n});\n\nconst PORT = process.env.PORT ?? 3000;\napp.listen(PORT, () => console.log(\`Server running on http://localhost:\${PORT}\`));\n`;

    return (
      `Building a Node.js Express API — ${appDesc}.\n\n` +
      `\`\`\`json title="package.json"\n${pkg}\n\`\`\`\n\n` +
      `\`\`\`js title="src/index.js"\n${mainCode}\`\`\`\n\n` +
      '**Run:** `npm install && npm run dev`\n' +
      '**What to check:** `curl http://localhost:3000/health` returns `{"status":"ok"}`.'
    );
  }

export function generateBuilderStorefrontApp(_desc: string): string {
    return [
      '```json title="package.json"',
      JSON.stringify({
        name: 'custom-storefront',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc -b && vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^18.3.1',
          'react-dom': '^18.3.1',
        },
        devDependencies: {
          '@types/react': '^18.3.1',
          '@types/react-dom': '^18.3.1',
          '@vitejs/plugin-react': '^4.3.1',
          typescript: '^5.5.3',
          vite: '^5.4.10',
        },
      }, null, 2),
      '```',
      '',
      '```html title="index.html"',
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <title>Custom Storefront</title>',
      '    <script type="module" src="/src/main.tsx"></script>',
      '  </head>',
      '  <body>',
      '    <div id="root"></div>',
      '  </body>',
      '</html>',
      '```',
      '',
      '```tsx title="src/main.tsx"',
      "import { StrictMode } from 'react';",
      "import { createRoot } from 'react-dom/client';",
      "import App from './App.tsx';",
      "import './styles.css';",
      '',
      "createRoot(document.getElementById('root')!).render(",
      '  <StrictMode>',
      '    <App />',
      '  </StrictMode>,',
      ');',
      '```',
      '',
      '```tsx title="src/App.tsx"',
      "import { useMemo, useState } from 'react';",
      '',
      'type Product = {',
      '  id: string;',
      '  name: string;',
      '  category: string;',
      '  price: number;',
      '  note: string;',
      '  accent: string;',
      '};',
      '',
      "const promptLabel = 'Premium home goods store';",
      "const brandName = 'Maison Grove';",
      '',
      'const products = [',
      "  { id: 'linen-01', name: 'Linen Carryall', category: 'Bags', price: 84, note: 'Soft structure, everyday size, and a premium neutral finish.', accent: 'linear-gradient(135deg, #f59e0b, #fb7185)' },",
      "  { id: 'ceramic-02', name: 'Stone Mug Set', category: 'Home', price: 46, note: 'Stackable ceramics designed for gifting and repeat purchase.', accent: 'linear-gradient(135deg, #38bdf8, #818cf8)' },",
      "  { id: 'serum-03', name: 'Night Serum', category: 'Wellness', price: 62, note: 'A hero product card with premium margins, trust copy, and refill logic.', accent: 'linear-gradient(135deg, #22c55e, #14b8a6)' },",
      "  { id: 'journal-04', name: 'Grid Journal', category: 'Desk', price: 28, note: 'A lower-ticket add-on that rounds out the cart and checkout mix.', accent: 'linear-gradient(135deg, #a78bfa, #ec4899)' },",
      "  { id: 'lamp-05', name: 'Halo Lamp', category: 'Lighting', price: 138, note: 'A larger anchor product to prove the layout can support mixed pricing.', accent: 'linear-gradient(135deg, #f97316, #facc15)' },",
      "  { id: 'throw-06', name: 'Woven Throw', category: 'Living', price: 96, note: 'Warm texture photography and straightforward shipping cues.', accent: 'linear-gradient(135deg, #60a5fa, #22d3ee)' },",
      '] satisfies Product[];',
      '',
      'const promises = [',
      "  'Room-led catalog browsing with real product context',",
      "  'Product detail, materials, price, and shipping cues in one surface',",
      "  'A cart summary that updates immediately and leads toward checkout',",
      '];',
      '',
      'export default function App() {',
      "  const [selectedId, setSelectedId] = useState(products[0]?.id ?? '');",
      "  const [cartIds, setCartIds] = useState<string[]>(products[1] ? [products[1].id] : []);",
      '  const selected = useMemo(() => products.find((product) => product.id === selectedId) ?? products[0], [selectedId]);',
      '  const cartProducts = useMemo(() => cartIds.map((id) => products.find((product) => product.id === id)).filter(Boolean) as Product[], [cartIds]);',
      '  const subtotal = cartProducts.reduce((sum, product) => sum + product.price, 0);',
      '',
      '  if (!selected) return null;',
      '',
      '  const addSelectedToCart = () => {',
      '    setCartIds((current) => [...current, selected.id]);',
      '  };',
      '',
      '  return (',
      '    <main className="store-shell">',
      '      <section className="hero-card">',
      '        <div>',
      '          <p className="eyebrow">{promptLabel}</p>',
      '          <h1>{brandName} home goods storefront.</h1>',
      '          <p className="lede">A premium shopping flow for considered home pieces: browse a curated catalog, inspect materials and shipping confidence, add to cart, and continue into a checkout-ready summary.</p>',
      '          <div className="hero-points">',
      '            {promises.map((item) => (',
      '              <span key={item}>{item}</span>',
      '            ))}',
      '          </div>',
      '        </div>',
      '        <aside className="hero-note">',
      '          <span>Order snapshot</span>',
      '          <strong>{cartProducts.length} item{cartProducts.length === 1 ? "" : "s"} in cart</strong>',
      '          <p>Designed for a real buyer path: visible trust cues, subtotal clarity, and a single next action.</p>',
      '          <div className="metric-row">',
      '            <div><small>Products</small><strong>6</strong></div>',
      '            <div><small>Subtotal</small><strong>${subtotal.toFixed(0)}</strong></div>',
      '            <div><small>Checkout</small><strong>Ready</strong></div>',
      '          </div>',
      '        </aside>',
      '      </section>',
      '',
      '      <section className="commerce-grid">',
      '        <article className="catalog-panel">',
      '          <div className="section-head">',
      '            <div>',
      '              <p className="section-kicker">Catalog</p>',
      '              <h2>Featured home edit</h2>',
      '            </div>',
      '            <span>6 seeded products</span>',
      '          </div>',
      '          <div className="product-grid">',
      '            {products.map((product) => (',
      '              <button',
      '                key={product.id}',
      '                type="button"',
      '                className={`product-card ${selected.id === product.id ? "is-active" : ""}`}',
      '                onClick={() => setSelectedId(product.id)}',
      '              >',
      '                <div className="product-art" style={{ background: product.accent }} />',
      '                <div className="product-copy">',
      '                  <span>{product.category}</span>',
      '                  <strong>{product.name}</strong>',
      '                  <p>{product.note}</p>',
      '                  <em>${product.price}</em>',
      '                </div>',
      '              </button>',
      '            ))}',
      '          </div>',
      '        </article>',
      '',
      '        <article className="detail-panel">',
      '          <p className="section-kicker">Product detail</p>',
      '          <h2>{selected.name}</h2>',
      '          <p className="detail-price">${selected.price}</p>',
      '          <p className="detail-copy">{selected.note}</p>',
      '          <div className="detail-stack">',
      '            <div><small>Shipping</small><strong>Free over $80</strong></div>',
      '            <div><small>Availability</small><strong>Ready to ship</strong></div>',
      '            <div><small>Upsell lane</small><strong>Related add-ons next</strong></div>',
      '          </div>',
      '          <div className="detail-actions">',
      '            <button type="button" className="primary" onClick={addSelectedToCart}>Add to cart</button>',
      '            <button type="button" className="secondary">View sizing + care</button>',
      '          </div>',
      '        </article>',
      '',
      '        <aside className="cart-panel">',
      '          <p className="section-kicker">Cart summary</p>',
      '          <h2>Cart summary</h2>',
      '          <ul className="cart-list">',
      '            {cartProducts.map((product, index) => (',
      '              <li key={`${product.id}-${index}`}>',
      '                <div>',
      '                  <strong>{product.name}</strong>',
      '                  <span>{product.category}</span>',
      '                </div>',
      '                <em>${product.price}</em>',
      '              </li>',
      '            ))}',
      '          </ul>',
      '          <div className="cart-total">',
      '            <span>Estimated subtotal</span>',
      '            <strong>${subtotal.toFixed(0)}</strong>',
      '          </div>',
      '          <button type="button" className="primary cart-cta">Continue to checkout</button>',
      '        </aside>',
      '      </section>',
      '    </main>',
      '  );',
      '}',
      '```',
      '',
      '```css title="src/styles.css"',
      ":root { color: #1f2937; background: #f6f1ea; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }",
      '* { box-sizing: border-box; }',
      'body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #fbfaf7 0%, #f3eee6 100%); }',
      'button { font: inherit; }',
      '.store-shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 72px; }',
      '.hero-card { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(320px, 0.92fr); gap: 22px; padding: 30px; border-radius: 30px; background: #fffaf2; border: 1px solid #e5d9c7; box-shadow: 0 24px 70px rgba(71, 49, 28, 0.12); }',
      '.eyebrow, .section-kicker, .hero-note span, .section-head span, .product-copy span, .detail-stack small { margin: 0; color: #8a6434; font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }',
      'h1, h2, p, ul { margin: 0; padding: 0; }',
      'h1 { font-size: clamp(3rem, 6vw, 5rem); line-height: 0.96; letter-spacing: -0.055em; max-width: 12ch; color: #1f2937; }',
      '.lede { margin-top: 18px; max-width: 62ch; color: #5f5448; font-size: 18px; line-height: 1.75; }',
      '.hero-points { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }',
      '.hero-points span, .detail-stack div { padding: 12px 14px; border-radius: 18px; background: #f7efe3; border: 1px solid #e6d8c5; color: #40382f; }',
      '.hero-note { padding: 22px; border-radius: 26px; background: #172118; color: #fffaf2; border: 1px solid rgba(23,33,24,0.16); display: grid; gap: 12px; align-content: start; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); }',
      '.hero-note::before { content: ""; min-height: 170px; border-radius: 22px; background: linear-gradient(135deg, #c7a475 0%, #f1dfc5 45%, #49624c 100%); box-shadow: inset 0 -40px 80px rgba(23,33,24,0.22); }',
      '.hero-note strong { font-size: 30px; letter-spacing: -0.05em; }',
      '.hero-note p { color: #d9d2c5; line-height: 1.7; }',
      '.metric-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }',
      '.metric-row div { padding: 12px; border-radius: 18px; background: rgba(255,250,242,0.08); border: 1px solid rgba(255,250,242,0.14); }',
      '.metric-row small { display: block; color: #b9ad9d; font-size: 11px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.08em; }',
      '.metric-row strong { font-size: 18px; }',
      '.commerce-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.9fr) minmax(280px, 0.8fr); gap: 18px; margin-top: 22px; align-items: start; }',
      '.catalog-panel, .detail-panel, .cart-panel { padding: 22px; border-radius: 28px; background: rgba(255,250,242,0.92); border: 1px solid #e4d6c3; box-shadow: 0 22px 60px rgba(71,49,28,0.1); }',
      '.section-head { display: flex; justify-content: space-between; gap: 16px; align-items: end; margin-bottom: 18px; }',
      '.section-head h2, .detail-panel h2, .cart-panel h2 { font-size: 28px; letter-spacing: -0.05em; color: #1f2937; }',
      '.product-grid { display: grid; gap: 14px; }',
      '.product-card { width: 100%; padding: 0; border: 1px solid #e3d4bf; border-radius: 24px; overflow: hidden; background: #fffdf8; color: inherit; text-align: left; cursor: pointer; transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease; }',
      '.product-card.is-active { border-color: #49624c; box-shadow: 0 18px 45px rgba(73,98,76,0.16); }',
      '.product-card:hover, .primary:hover, .secondary:hover { transform: translateY(-2px); }',
      '.product-art { min-height: 150px; position: relative; overflow: hidden; }',
      '.product-art::before { content: ""; position: absolute; left: 12%; bottom: 18%; width: 36%; height: 54%; border-radius: 999px 999px 28px 28px; background: rgba(255,250,242,0.82); box-shadow: 76px 18px 0 rgba(31,41,55,0.13), 128px -8px 0 rgba(255,250,242,0.55); }',
      '.product-art::after { content: ""; position: absolute; right: 12%; top: 18%; width: 28%; height: 18%; border-radius: 999px; background: rgba(23,33,24,0.18); }',
      '.product-copy { padding: 18px; display: grid; gap: 8px; }',
      '.product-copy strong { font-size: 24px; letter-spacing: -0.04em; color: #1f2937; }',
      '.product-copy p, .detail-copy, .cart-list span { color: #62574b; line-height: 1.7; }',
      '.product-copy em, .detail-price, .cart-list em, .cart-total strong { font-style: normal; color: #1f2937; font-size: 20px; font-weight: 700; }',
      '.detail-price { margin-top: 14px; }',
      '.detail-copy { margin-top: 10px; }',
      '.detail-stack { display: grid; gap: 10px; margin-top: 18px; }',
      '.detail-stack strong { display: block; margin-top: 6px; font-size: 16px; }',
      '.detail-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }',
      '.primary, .secondary { border-radius: 999px; padding: 14px 18px; cursor: pointer; transition: transform 0.18s ease, box-shadow 0.18s ease; }',
      '.primary { border: none; background: #49624c; color: #fffaf2; box-shadow: 0 18px 36px rgba(73,98,76,0.2); font-weight: 800; }',
      '.secondary { border: 1px solid #d8c7b0; background: #fffaf2; color: #40382f; }',
      '.cart-list { list-style: none; display: grid; gap: 12px; margin-top: 18px; }',
      '.cart-list li { display: flex; justify-content: space-between; gap: 16px; padding: 14px 0; border-top: 1px solid #e4d6c3; }',
      '.cart-list li:first-child { border-top: none; padding-top: 0; }',
      '.cart-list strong { display: block; margin-bottom: 6px; font-size: 16px; }',
      '.cart-total { display: flex; justify-content: space-between; align-items: center; margin-top: 18px; padding-top: 18px; border-top: 1px solid #e4d6c3; }',
      '.cart-total span { color: #62574b; }',
      '.cart-cta { width: 100%; margin-top: 16px; justify-content: center; }',
      '@media (max-width: 1040px) { .hero-card, .commerce-grid { grid-template-columns: 1fr; } .metric-row { grid-template-columns: repeat(3, minmax(0, 1fr)); } }',
      '@media (max-width: 720px) { .store-shell { width: min(100%, calc(100% - 20px)); padding-top: 18px; } .hero-card, .catalog-panel, .detail-panel, .cart-panel { padding: 18px; } .metric-row { grid-template-columns: 1fr; } }',
      '```',
      '',
      '```json title="tsconfig.json"',
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'Bundler',
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
        },
        include: ['src'],
      }, null, 2),
      '```',
    ].join('\n');
  }

export function generateBuilderSpecializedViteApp(config: {
    name: string;
    title: string;
    kicker: string;
    lede: string;
    metrics: Array<{ label: string; value: string }>;
    cards: Array<{ title: string; body: string; meta: string }>;
    actions: string[];
    includeUpload?: boolean;
  }): string {
    const appTsx = [
      'const metrics = ' + JSON.stringify(config.metrics, null, 2) + ' as const;',
      'const cards = ' + JSON.stringify(config.cards, null, 2) + ' as const;',
      'const actions = ' + JSON.stringify(config.actions, null, 2) + ' as const;',
      '',
      'export default function App() {',
      '  return (',
      '    <main className="shell">',
      '      <section className="hero">',
      `        <p className="eyebrow">${config.kicker}</p>`,
      `        <h1>${config.title}</h1>`,
      `        <p className="lede">${config.lede}</p>`,
      '        <div className="metrics">',
      '          {metrics.map((metric) => (',
      '            <article key={metric.label} className="metric">',
      '              <span>{metric.label}</span>',
      '              <strong>{metric.value}</strong>',
      '            </article>',
      '          ))}',
      '        </div>',
      '      </section>',
      '',
      config.includeUpload ? [
        '      <section className="dropzone">',
        '        <label htmlFor="asset-upload">Drag-and-drop upload</label>',
        '        <input id="asset-upload" type="file" accept="image/*,.svg" />',
        '        <div className="control-row">',
        '          <button type="button">SVG to PNG export</button>',
        '          <button type="button">2x scale</button>',
        '          <button type="button">4x scale</button>',
        '          <button type="button">Square crop</button>',
        '          <button type="button">Square padding</button>',
        '          <button type="button">Download</button>',
        '        </div>',
        '      </section>',
        '',
      ].join('\n') : '',
      '      <section className="grid">',
      '        {cards.map((card) => (',
      '          <article key={card.title} className="card">',
      '            <span>{card.meta}</span>',
      '            <h2>{card.title}</h2>',
      '            <p>{card.body}</p>',
      '          </article>',
      '        ))}',
      '      </section>',
      '',
      '      <section className="actions">',
      '        <h2>Action loop</h2>',
      '        {actions.map((action) => <button key={action} type="button">{action}</button>)}',
      '      </section>',
      '    </main>',
      '  );',
      '}',
    ].join('\n');

    const stylesCss = [
      ':root { color: #f8fafc; background: #080b12; font-family: "Space Grotesk", "Segoe UI", sans-serif; }',
      '* { box-sizing: border-box; }',
      'body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 12% 8%, rgba(56,189,248,.2), transparent 28%), radial-gradient(circle at 88% 16%, rgba(244,114,182,.16), transparent 24%), linear-gradient(145deg, #080b12, #111827 58%, #030712); }',
      'button, input { font: inherit; }',
      '.shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0 72px; }',
      '.hero, .dropzone, .card, .actions { border: 1px solid rgba(255,255,255,.12); background: rgba(8,13,24,.76); box-shadow: 0 28px 80px rgba(0,0,0,.28); backdrop-filter: blur(18px); }',
      '.hero { border-radius: 34px; padding: clamp(24px, 5vw, 48px); }',
      '.eyebrow { margin: 0 0 12px; color: #67e8f9; font-size: 12px; font-weight: 900; letter-spacing: .18em; text-transform: uppercase; }',
      'h1 { margin: 0; max-width: 12ch; font-size: clamp(3rem, 7vw, 6.4rem); line-height: .88; letter-spacing: -.07em; }',
      'h2, p { margin: 0; }',
      '.lede { max-width: 68ch; margin-top: 20px; color: #cbd5e1; font-size: 18px; line-height: 1.75; }',
      '.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 28px; }',
      '.metric, .card { border-radius: 24px; padding: 18px; background: rgba(15,23,42,.74); border: 1px solid rgba(255,255,255,.1); }',
      '.metric span, .card span { display: block; color: #94a3b8; font-size: 12px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }',
      '.metric strong { display: block; margin-top: 8px; font-size: 24px; }',
      '.dropzone { margin-top: 18px; border-radius: 28px; padding: 22px; display: grid; gap: 14px; }',
      '.dropzone label { font-size: 22px; font-weight: 900; }',
      'input[type="file"] { width: 100%; padding: 18px; border-radius: 20px; border: 1px dashed rgba(103,232,249,.6); color: #dbeafe; background: rgba(15,23,42,.78); }',
      '.control-row, .actions { display: flex; flex-wrap: wrap; gap: 12px; }',
      'button { border: 0; border-radius: 999px; padding: 12px 16px; color: #06111c; background: linear-gradient(135deg, #67e8f9, #f0abfc); font-weight: 900; cursor: pointer; transition: transform .18s ease, filter .18s ease; }',
      'button:hover { transform: translateY(-2px); filter: brightness(1.08); }',
      '.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }',
      '.card h2 { margin-top: 12px; font-size: 26px; letter-spacing: -.04em; }',
      '.card p { margin-top: 10px; color: #cbd5e1; line-height: 1.7; }',
      '.actions { margin-top: 18px; border-radius: 28px; padding: 22px; align-items: center; }',
      '.actions h2 { width: 100%; font-size: 22px; }',
      '@media (max-width: 920px) { .metrics, .grid { grid-template-columns: 1fr 1fr; } }',
      '@media (max-width: 640px) { .metrics, .grid { grid-template-columns: 1fr; } .shell { width: min(100% - 20px, 1180px); } }',
    ].join('\n');

    return [
      '```json title="package.json"',
      JSON.stringify({
        name: config.name,
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
        dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
        devDependencies: {
          '@types/react': '^18.3.1',
          '@types/react-dom': '^18.3.1',
          '@vitejs/plugin-react': '^4.3.1',
          typescript: '^5.5.3',
          vite: '^5.4.10',
        },
      }, null, 2),
      '```',
      '',
      '```html title="index.html"',
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      `    <title>${config.title}</title>`,
      '    <script type="module" src="/src/main.tsx"></script>',
      '  </head>',
      '  <body><div id="root"></div></body>',
      '</html>',
      '```',
      '',
      '```tsx title="src/main.tsx"',
      "import { StrictMode } from 'react';",
      "import { createRoot } from 'react-dom/client';",
      "import App from './App.tsx';",
      "import './styles.css';",
      "createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);",
      '```',
      '',
      '```tsx title="src/App.tsx"',
      appTsx,
      '```',
      '',
      '```css title="src/styles.css"',
      stylesCss,
      '```',
      '',
      '```json title="tsconfig.json"',
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
        },
        include: ['src'],
      }, null, 2),
      '```',
    ].join('\n');
  }

export function generateBuilderTypescriptLibraryMonorepoStarter(_desc: string): string {
    const packageJson = JSON.stringify({
      name: 'acme-corp-lib-starter',
      private: true,
      type: 'module',
      packageManager: 'pnpm@9.12.0',
      scripts: {
        build: 'pnpm -r build',
        test: 'pnpm -r test',
        changeset: 'changeset',
        version: 'changeset version',
      },
      devDependencies: {
        '@changesets/cli': '^2.27.9',
        typescript: '^5.5.3',
        vitest: '^2.1.1',
      },
      workspaces: ['packages/*'],
    }, null, 2);

    return [
      'Complete TypeScript library monorepo starter with Prisma generator support, vitest tests, and changeset release flow.',
      '',
      '```json title="package.json"',
      packageJson,
      '```',
      '',
      '```yaml title="pnpm-workspace.yaml"',
      'packages:',
      "  - 'packages/*'",
      '```',
      '',
      '```json title="tsconfig.json"',
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          declaration: true,
          strict: true,
          skipLibCheck: true,
        },
        include: ['packages/**/*.ts'],
      }, null, 2),
      '```',
      '',
      '```ts title="packages/core/src/index.ts"',
      "export type AcmeLibraryOptions = { appName: string; enableTelemetry?: boolean };",
      '',
      'export function createAcmeLibrary(options: AcmeLibraryOptions) {',
      '  return {',
      '    kind: "TypeScript library monorepo",',
      '    appName: options.appName,',
      '    telemetry: options.enableTelemetry === true,',
      '  } as const;',
      '}',
      '',
      'export const libraryHealth = { vitest: "configured", changeset: "required", prisma: "generator-ready" } as const;',
      '```',
      '',
      '```ts title="packages/prisma-generator/src/index.ts"',
      'import { generatorHandler } from "@prisma/generator-helper";',
      '',
      'generatorHandler({',
      '  onManifest() {',
      '    return {',
      '      defaultOutput: "./generated",',
      '      prettyName: "Acme enum bundle-size generator",',
      '    };',
      '  },',
      '  async onGenerate(options) {',
      '    const enums = options.dmmf.datamodel.enums.map((item) => item.name);',
      '    const output = `export const prismaEnums = ${JSON.stringify(enums)} as const;\\n`;',
      '    await options.generator.output?.value && Bun.write(`${options.generator.output.value}/enums.ts`, output);',
      '  },',
      '});',
      '```',
      '',
      '```ts title="packages/core/src/index.test.ts"',
      "import { describe, expect, it } from 'vitest';",
      "import { createAcmeLibrary } from './index';",
      '',
      "describe('createAcmeLibrary', () => {",
      "  it('returns typed library metadata', () => {",
      "    expect(createAcmeLibrary({ appName: 'demo' }).kind).toContain('library monorepo');",
      '  });',
      '});',
      '```',
      '',
      '```md title=".changeset/initial-release.md"',
      '---',
      '"@acme/core": patch',
      '"@acme/prisma-generator": patch',
      '---',
      '',
      'Initial TypeScript library monorepo with Prisma generator and vitest coverage.',
      '```',
    ].join('\n');
  }

export function generateBuilderDeveloperDefaultsCli(_desc: string): string {
    const packageJson = JSON.stringify({
      name: 'good-defaults-cli',
      version: '0.1.0',
      type: 'module',
      bin: { 'good-defaults': './dist/cli.js' },
      scripts: {
        dev: 'tsx src/cli.ts',
        build: 'tsc -p tsconfig.json',
        test: 'vitest run',
      },
      dependencies: {
        '@inquirer/prompts': '^5.5.0',
        'fs-extra': '^11.2.0',
      },
      devDependencies: {
        '@types/node': '^22.7.4',
        tsx: '^4.19.1',
        typescript: '^5.5.3',
        vitest: '^2.1.1',
      },
    }, null, 2);

    return [
      'Runnable TypeScript CLI for scaffolding good project defaults: ESLint, Prettier, VS Code settings/extensions, strict TSConfig, and GitHub Actions CI with pnpm caching.',
      '',
      '```json title="package.json"',
      packageJson,
      '```',
      '',
      '```json title="tsconfig.json"',
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          outDir: 'dist',
          skipLibCheck: true,
        },
        include: ['src'],
      }, null, 2),
      '```',
      '',
      '```ts title="src/templates.ts"',
      'export type DefaultChoice = "eslint-prettier" | "vscode" | "tsconfig" | "github-actions";',
      '',
      'export const templates: Record<DefaultChoice, { path: string; label: string; content: string }> = {',
      '  "eslint-prettier": {',
      '    path: ".eslintrc.cjs",',
      '    label: "ESLint + Prettier",',
      '    content: "module.exports = { extends: [\'eslint:recommended\', \'prettier\'] };\\n",',
      '  },',
      '  vscode: {',
      '    path: ".vscode/extensions.json",',
      '    label: "VS Code settings and recommended extensions",',
      '    content: JSON.stringify({ recommendations: ["dbaeumer.vscode-eslint", "esbenp.prettier-vscode"] }, null, 2),',
      '  },',
      '  tsconfig: {',
      '    path: "tsconfig.json",',
      '    label: "Strict TSConfig",',
      '    content: JSON.stringify({ compilerOptions: { strict: true, moduleResolution: "Bundler" } }, null, 2),',
      '  },',
      '  "github-actions": {',
      '    path: ".github/workflows/ci.yml",',
      '    label: "GitHub Actions CI with pnpm caching",',
      '    content: "name: CI\\non: [push, pull_request]\\njobs:\\n  test:\\n    runs-on: ubuntu-latest\\n    steps:\\n      - uses: actions/checkout@v4\\n      - uses: pnpm/action-setup@v4\\n      - uses: actions/setup-node@v4\\n        with:\\n          node-version: 22\\n          cache: pnpm\\n      - run: pnpm install --frozen-lockfile\\n      - run: pnpm test\\n",',
      '  },',
      '};',
      '```',
      '',
      '```ts title="src/cli.ts"',
      "#!/usr/bin/env node",
      "import { checkbox, confirm } from '@inquirer/prompts';",
      "import { mkdir, writeFile } from 'node:fs/promises';",
      "import { dirname } from 'node:path';",
      "import { templates, type DefaultChoice } from './templates';",
      '',
      'const choices = await checkbox<DefaultChoice>({',
      '  message: "Select good defaults to scaffold",',
      '  choices: Object.entries(templates).map(([value, template]) => ({ value: value as DefaultChoice, name: template.label })),',
      '});',
      '',
      'const usePnpm = await confirm({ message: "Use pnpm caching in GitHub Actions?", default: true });',
      'for (const choice of choices) {',
      '  const template = templates[choice];',
      '  await mkdir(dirname(template.path), { recursive: true });',
      '  await writeFile(template.path, template.content.replace("cache: pnpm", usePnpm ? "cache: pnpm" : ""), "utf8");',
      '  console.log(`Wrote ${template.label} -> ${template.path}`);',
      '}',
      '```',
      '',
      '```yaml title=".github/workflows/ci.yml"',
      'name: GitHub Actions CI',
      'on: [push, pull_request]',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: pnpm/action-setup@v4',
      '      - uses: actions/setup-node@v4',
      '        with:',
      '          node-version: 22',
      '          cache: pnpm',
      '      - run: pnpm install --frozen-lockfile',
      '      - run: pnpm test',
      '```',
    ].join('\n');
  }

export function generateBuilderAgentWorkflowToolsSuite(_desc: string): string {
    return [
      'TypeScript monorepo of agent workflow tools: a Convex Vite plugin for isolated agent environments and an Oxlint plugin for unused Convex functions.',
      '',
      '```json title="package.json"',
      JSON.stringify({
        name: 'agent-workflow-tools-suite',
        private: true,
        type: 'module',
        workspaces: ['packages/*'],
        scripts: { build: 'pnpm -r build', test: 'pnpm -r test' },
        devDependencies: { typescript: '^5.5.3', vitest: '^2.1.1' },
      }, null, 2),
      '```',
      '',
      '```ts title="packages/convex-vite-plugin/src/index.ts"',
      "import type { Plugin } from 'vite';",
      '',
      'export const toolDescription = "Convex Vite plugin for isolated coding agent environments";',
      'export type ConvexAgentEnvOptions = { agentId: string; projectRoot?: string };',
      '',
      'export function convexAgentEnv(options: ConvexAgentEnvOptions): Plugin {',
      '  const envName = `convex-agent-${options.agentId}`;',
      '  return {',
      '    name: "convex-vite-plugin-agent-env",',
      '    config(config) {',
      '      return {',
      '        define: {',
      '          ...config.define,',
      '          "process.env.CONVEX_AGENT_ENV": JSON.stringify(envName),',
      '        },',
      '      };',
      '    },',
      '  };',
      '}',
      '```',
      '',
      '```ts title="packages/oxlint-plugin-convex/src/index.ts"',
      'export type ConvexFunctionUsage = { name: string; referenced: boolean; file: string };',
      '',
      'export function findUnusedConvexFunctions(functions: ConvexFunctionUsage[]) {',
      '  return functions.filter((fn) => !fn.referenced).map((fn) => ({',
      '    message: `Unused Convex function left behind by an AI agent: ${fn.name}`,',
      '    file: fn.file,',
      '    severity: "warning" as const,',
      '  }));',
      '}',
      '',
      'export const oxlintPluginConvex = {',
      '  name: "oxlint-plugin-convex-unused-functions",',
      '  rules: { "no-unused-convex-functions": findUnusedConvexFunctions },',
      '};',
      '```',
      '',
      '```ts title="examples/usage.ts"',
      "import { defineConfig } from 'vite';",
      "import { convexAgentEnv } from '../packages/convex-vite-plugin/src/index';",
      "import { findUnusedConvexFunctions } from '../packages/oxlint-plugin-convex/src/index';",
      '',
      'export default defineConfig({ plugins: [convexAgentEnv({ agentId: "codex-42" })] });',
      'console.log(findUnusedConvexFunctions([{ name: "internal.users.cleanup", referenced: false, file: "convex/users.ts" }]));',
      '```',
      '',
      'Safety notes: keep each agent isolated, never share production Convex credentials in generated envs, and fail CI on repeated unused function warnings.',
    ].join('\n');
  }

export function generateBuilderPythonUploadSdkFastApi(_desc: string): string {
    return [
      'Unofficial Python SDK package with async UTApi client, typed models, FastAPI adapter, CORS example, UPLOADTHING_SECRET usage, and quickstart.',
      '',
      '```toml title="pyproject.toml"',
      '[project]',
      'name = "uploadthing-py"',
      'version = "0.1.0"',
      'description = "Unofficial async Python SDK for a file-upload service"',
      'requires-python = ">=3.11"',
      'dependencies = ["httpx>=0.27", "pydantic>=2", "fastapi>=0.111"]',
      '',
      '[tool.pytest.ini_options]',
      'asyncio_mode = "auto"',
      '```',
      '',
      '```py title="uploadthing_py/__init__.py"',
      'from .client import UTApi',
      'from .fastapi import create_route_handler',
      '',
      '__all__ = ["UTApi", "create_route_handler"]',
      '```',
      '',
      '```py title="uploadthing_py/client.py"',
      'from dataclasses import dataclass',
      'import httpx',
      '',
      '@dataclass(frozen=True)',
      'class UploadFile:',
      '    key: str',
      '    name: str',
      '    size: int',
      '',
      'class UTApi:',
      '    def __init__(self, secret: str, base_url: str = "https://api.uploadthing.com"):',
      '        self.secret = secret',
      '        self.base_url = base_url.rstrip("/")',
      '',
      '    async def list_files(self) -> list[UploadFile]:',
      '        async with httpx.AsyncClient() as client:',
      '            res = await client.get(f"{self.base_url}/v6/listFiles", headers={"x-uploadthing-api-key": self.secret})',
      '            res.raise_for_status()',
      '            return [UploadFile(**item) for item in res.json().get("files", [])]',
      '',
      '    async def delete_file(self, key: str) -> dict:',
      '        async with httpx.AsyncClient() as client:',
      '            res = await client.post(f"{self.base_url}/v6/deleteFiles", json={"fileKeys": [key]}, headers={"x-uploadthing-api-key": self.secret})',
      '            res.raise_for_status()',
      '            return res.json()',
      '```',
      '',
      '```py title="uploadthing_py/fastapi.py"',
      'import os',
      'from fastapi import APIRouter, FastAPI, Request, Response',
      'from fastapi.middleware.cors import CORSMiddleware',
      'from .client import UTApi',
      '',
      'def create_route_handler(secret: str | None = None) -> APIRouter:',
      '    router = APIRouter()',
      '    utapi = UTApi(secret or os.environ["UPLOADTHING_SECRET"])',
      '',
      '    @router.get("/files")',
      '    async def list_files():',
      '        return await utapi.list_files()',
      '',
      '    @router.delete("/files/{key}")',
      '    async def delete_file(key: str):',
      '        return await utapi.delete_file(key)',
      '',
      '    return router',
      '',
      'def install_cors(app: FastAPI) -> None:',
      '    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])',
      '```',
      '',
      '```py title="examples/fastapi_app.py"',
      'from fastapi import FastAPI',
      'from uploadthing_py.fastapi import create_route_handler, install_cors',
      '',
      'app = FastAPI()',
      'install_cors(app)',
      'app.include_router(create_route_handler(), prefix="/api/uploadthing")',
      '```',
      '',
      '```py title="examples/quickstart.py"',
      'import asyncio, os',
      'from uploadthing_py import UTApi',
      '',
      'async def main():',
      '    api = UTApi(os.environ["UPLOADTHING_SECRET"])',
      '    files = await api.list_files()',
      '    print("List files:", files)',
      '    if files:',
      '        print("Delete file:", await api.delete_file(files[0].key))',
      '',
      'if __name__ == "__main__":',
      '    asyncio.run(main())',
      '```',
    ].join('\n');
  }

export function generateBuilderTailwindCanonicalVsCodeExtension(_desc: string): string {
    return [
      'VS Code extension that auto-fixes Tailwind CSS canonical class diagnostics on save.',
      '',
      '```json title="package.json"',
      JSON.stringify({
        name: 'tailwind-canonical-classes-autofix',
        displayName: 'Tailwind Canonical Classes Autofix',
        description: 'VS Code extension that auto-fixes Tailwind CSS canonical class suggestions from Tailwind CSS IntelliSense diagnostics on save.',
        version: '0.1.0',
        publisher: 'local-dev',
        engines: { vscode: '^1.90.0' },
        activationEvents: ['onLanguage:html', 'onLanguage:typescriptreact', 'onLanguage:javascriptreact'],
        main: './dist/extension.js',
        contributes: {
          configuration: {
            title: 'Tailwind Canonical Classes',
            properties: {
              'tailwindCanonicalClasses.fixOnSave': {
                type: 'boolean',
                default: true,
                description: 'Apply canonical Tailwind CSS class fixes before save.',
              },
            },
          },
        },
        scripts: { compile: 'tsc -p ./', test: 'vitest run' },
        devDependencies: { '@types/vscode': '^1.90.0', typescript: '^5.5.3', vitest: '^2.1.1' },
      }, null, 2),
      '```',
      '',
      '```ts title="src/extension.ts"',
      "import * as vscode from 'vscode';",
      '',
      'const canonicalMessage = /The class `([^`]+)` can be written as `([^`]+)`/;',
      '',
      'export function activate(context: vscode.ExtensionContext) {',
      "  const disposable = vscode.workspace.onWillSaveTextDocument(async (event) => {",
      "    const enabled = vscode.workspace.getConfiguration('tailwindCanonicalClasses').get<boolean>('fixOnSave', true);",
      '    if (!enabled) return;',
      '',
      '    const diagnostics = vscode.languages.getDiagnostics(event.document.uri);',
      '    const edit = new vscode.WorkspaceEdit();',
      '    for (const diagnostic of diagnostics) {',
      '      const match = canonicalMessage.exec(String(diagnostic.message));',
      '      if (!match) continue;',
      '      const currentText = event.document.getText(diagnostic.range);',
      '      if (currentText.includes(match[1])) {',
      '        edit.replace(event.document.uri, diagnostic.range, currentText.replace(match[1], match[2]));',
      '      }',
      '    }',
      '    await vscode.workspace.applyEdit(edit);',
      '  });',
      '',
      '  context.subscriptions.push(disposable);',
      '}',
      '',
      'export function deactivate() {}',
      '```',
      '',
      '```md title="README.md"',
      '# Tailwind Canonical Classes Autofix',
      '',
      'A VS Code extension that auto-fixes Tailwind CSS canonical class suggestions on save by reading Tailwind CSS IntelliSense diagnostics shaped like `The class ... can be written as ...`.',
      '',
      '## Setting',
      '',
      '- `tailwindCanonicalClasses.fixOnSave`: enable or disable applying canonical class fixes on save.',
      '```',
    ].join('\n');
  }

export function generateBuilderMinimalJsVsCodeThemeExtension(_desc: string): string {
    const themePath = 'themes/minimal-js-theme.json';
    const theme = {
      name: 'Minimal JS Theme',
      type: 'dark',
      colors: {
        'editor.background': '#111318',
        'editor.foreground': '#dde3ee',
        'activityBar.background': '#111318',
        'activityBar.foreground': '#111318',
        'sideBar.background': '#161a22',
        'sideBar.foreground': '#c4ccd9',
        'statusBar.background': '#111318',
        'statusBar.foreground': '#111318',
        'titleBar.activeBackground': '#111318',
        'titleBar.activeForeground': '#d7deea',
      },
      tokenColors: [
        { scope: ['keyword', 'storage.type'], settings: { foreground: '#d2a8ff' } },
        { scope: ['entity.name.function', 'support.function'], settings: { foreground: '#8cc8ff' } },
        { scope: ['entity.name.class', 'support.class'], settings: { foreground: '#ffd58a' } },
        { scope: ['string'], settings: { foreground: '#b8e28a' } },
        { scope: ['variable', 'meta.object-literal.key'], settings: { foreground: '#f2f5fa' } },
        { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#6e7785', fontStyle: 'italic' } },
      ],
    };

    return [
      '```json title="package.json"',
      JSON.stringify({
        name: 'minimal-js-theme',
        displayName: 'Minimal JS Theme',
        description: 'A minimalistic, opinionated VS Code theme focused mostly on JavaScript with a hidden-status-bar philosophy.',
        version: '0.0.1',
        publisher: 'local-dev',
        engines: { vscode: '^1.90.0' },
        categories: ['Themes'],
        contributes: {
          themes: [
            {
              label: 'Minimal JS Theme',
              uiTheme: 'vs-dark',
              path: `./${themePath}`,
            },
          ],
        },
      }, null, 2),
      '```',
      '',
      '```json title="themes/minimal-js-theme.json"',
      JSON.stringify(theme, null, 2),
      '```',
      '',
      '```md title="README.md"',
      '# Minimal JS Theme',
      '',
      'A minimalistic, opinionated VS Code theme focused mostly on JavaScript. The philosophy is simple: keep the editor quiet, keep JavaScript token colors legible, and hide chrome that distracts from the code.',
      '',
      '## Philosophy',
      '',
      '- Minimalistic surface with a hidden status bar and dim activity bar so the editor stays visually calm.',
      '- JavaScript-focused token colors: keywords, functions, classes, strings, and object keys are easy to scan at a glance.',
      '- Opinionated on purpose: this theme works best when the interface chrome fades into the background.',
      '',
      '## Suggested settings',
      '',
      'Recommended settings JSON:',
      '  {',
      '    "editor.lineNumbers": "off",',
      '    "workbench.activityBar.visible": false,',
      '    "editor.minimap.enabled": false,',
      '    "workbench.statusBar.visible": false',
      '  }',
      'That combination hides line numbers, the activity bar, the minimap, and the status bar to match the intended reading experience.',
      '```',
    ].join('\n');
  }

export function generateBuilderVsCodeThemeExtension(_desc: string): string {
    const themePath = 'themes/safe-material-color-theme.json';
    const theme = {
      name: 'Safe Material Dark',
      type: 'dark',
      colors: {
        'editor.background': '#10151f',
        'editor.foreground': '#d9e2f1',
        'activityBar.background': '#0b1018',
        'activityBar.foreground': '#8bd5ff',
        'sideBar.background': '#111827',
        'sideBar.foreground': '#c7d2fe',
        'statusBar.background': '#0f172a',
        'titleBar.activeBackground': '#0b1018',
      },
      tokenColors: [
        { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#6b7280', fontStyle: 'italic' } },
        { scope: ['string', 'constant.other.symbol'], settings: { foreground: '#c3e88d' } },
        { scope: ['entity.name.function', 'support.function'], settings: { foreground: '#82aaff' } },
        { scope: ['entity.name.class', 'support.class'], settings: { foreground: '#ffcb6b' } },
        { scope: ['keyword', 'storage.type'], settings: { foreground: '#c792ea' } },
      ],
    };

    return [
      '```json title="package.json"',
      JSON.stringify({
        name: 'safe-material-dark-theme',
        displayName: 'Safe Material Dark Theme',
        description: 'A safe Material-inspired VS Code color-theme extension that avoids protected branding while keeping a calm dark editor palette.',
        version: '0.0.1',
        publisher: 'local-dev',
        engines: { vscode: '^1.90.0' },
        categories: ['Themes'],
        contributes: {
          themes: [
            {
              label: 'Safe Material Dark',
              uiTheme: 'vs-dark',
              path: `./${themePath}`,
            },
          ],
        },
      }, null, 2),
      '```',
      '',
      '```json title="themes/safe-material-color-theme.json"',
      JSON.stringify(theme, null, 2),
      '```',
      '',
      'Install locally with `code --install-extension` after packaging with `vsce package`.',
    ].join('\n');
  }

export function generateBuilderReactLagRadarPackage(_desc: string): string {
    return [
      '```json title="package.json"',
      JSON.stringify({
        name: 'react-lag-radar-lite',
        version: '0.1.0',
        private: false,
        type: 'module',
        main: './dist/index.js',
        module: './dist/index.js',
        types: './dist/index.d.ts',
        scripts: {
          build: 'tsc -p tsconfig.json',
        },
        peerDependencies: {
          react: '^18.3.1 || ^19.0.0',
          'react-dom': '^18.3.1 || ^19.0.0',
        },
        devDependencies: {
          '@types/react': '^18.3.1',
          '@types/react-dom': '^18.3.1',
          typescript: '^5.5.3',
        },
      }, null, 2),
      '```',
      '',
      '```tsx title="src/index.tsx"',
      "import { useEffect, useRef } from 'react';",
      '',
      'export type LagRadarProps = {',
      '  frames?: number;',
      '  speed?: number;',
      '  size?: number;',
      '  inset?: number;',
      '};',
      '',
      'export function LagRadar({ frames = 60, speed = 0.15, size = 120, inset = 24 }: LagRadarProps) {',
      '  const canvasRef = useRef<HTMLCanvasElement | null>(null);',
      '',
      '  useEffect(() => {',
      '    const canvas = canvasRef.current;',
      '    if (!canvas) return;',
      '    const context = canvas.getContext("2d");',
      '    if (!context) return;',
      '',
      '    let raf = 0;',
      '    let ticks = 0;',
      '    let last = performance.now();',
      '    let lag = 0;',
      '',
      '    const draw = (now: number) => {',
      '      const delta = now - last;',
      '      last = now;',
      '      const budget = 1000 / frames;',
      '      lag = Math.max(0, lag * (1 - speed) + Math.max(0, delta - budget) * speed);',
      '      ticks += 1;',
      '',
      '      context.clearRect(0, 0, size, size);',
      '      context.beginPath();',
      '      context.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);',
      '      context.strokeStyle = "rgba(255,255,255,0.12)";',
      '      context.lineWidth = 8;',
      '      context.stroke();',
      '',
      '      context.beginPath();',
      '      context.arc(size / 2, size / 2, size / 2 - 10, -Math.PI / 2, -Math.PI / 2 + Math.min(1, lag / 32) * Math.PI * 2);',
      '      context.strokeStyle = lag > 12 ? "#ff7a59" : "#7ee787";',
      '      context.lineWidth = 8;',
      '      context.stroke();',
      '',
      '      context.fillStyle = "#e6edf3";',
      '      context.font = "600 12px system-ui";',
      '      context.textAlign = "center";',
      '      context.fillText(`lag radar`, size / 2, size / 2 - 6);',
      '      context.fillText(`${Math.round(lag)}ms`, size / 2, size / 2 + 14);',
      '',
      '      raf = requestAnimationFrame(draw);',
      '    };',
      '',
      '    raf = requestAnimationFrame(draw);',
      '    return () => cancelAnimationFrame(raf);',
      '  }, [frames, speed, size]);',
      '',
      '  return (',
      '    <canvas',
      '      ref={canvasRef}',
      '      width={size}',
      '      height={size}',
      '      style={{ position: "fixed", right: inset, bottom: inset, width: size, height: size, pointerEvents: "none", zIndex: 9999 }}',
      '      aria-label="lag radar"',
      '    />',
      '  );',
      '}',
      '```',
      '',
      '```md title="README.md"',
      '# React Lag Radar Lite',
      '',
      'A small React package that wraps a lag radar performance widget for development use. It helps detect dropped frames and responsiveness issues by showing a live radar when frame timing drifts above budget.',
      '',
      '## Props',
      '',
      '- `frames`: expected frame budget, usually `60`.',
      '- `speed`: smoothing factor for how quickly the radar responds.',
      '- `size`: rendered widget size in pixels.',
      '- `inset`: distance from the viewport edge.',
      '',
      '## Usage',
      '',
      "Import `LagRadar` from `react-lag-radar-lite` and render `<LagRadar frames={60} speed={0.2} size={120} inset={20} />` in your app root.",
      'The component is meant for development-only overlays while profiling dropped frames and general UI responsiveness.',
      '```',
    ].join('\n');
  }

export function generateBuilderBrowserLoggerPackage(_desc: string): string {
    return [
      '```json title="package.json"',
      JSON.stringify({
        name: 'browser-child-logger',
        version: '0.1.0',
        private: false,
        type: 'module',
        exports: {
          '.': './src/index.ts',
        },
      }, null, 2),
      '```',
      '',
      '```ts title="src/index.ts"',
      'export type LoggerOptions = {',
      '  collapse?: boolean;',
      '  groupByMessage?: boolean;',
      '};',
      '',
      'export type LogLevel = "debug" | "info" | "warn" | "error";',
      '',
      'export type BrowserLogger = {',
      '  child(scope: string, options?: LoggerOptions): BrowserLogger;',
      '  debug(message: string, meta?: Record<string, unknown>): void;',
      '  info(message: string, meta?: Record<string, unknown>): void;',
      '  warn(message: string, meta?: Record<string, unknown>): void;',
      '  error(message: string, meta?: Record<string, unknown>): void;',
      '};',
      '',
      'function write(level: LogLevel, scopes: string[], message: string, meta: Record<string, unknown> | undefined, options: LoggerOptions) {',
      '  const openGroup = options.collapse ? console.groupCollapsed : console.group;',
      '  const closeGroup = console.groupEnd;',
      '  for (const scope of scopes) openGroup(scope);',
      '  if (options.groupByMessage && message) openGroup(message);',
      '  console[level](message, meta ?? {});',
      '  if (options.groupByMessage && message) closeGroup();',
      '  for (let index = scopes.length - 1; index >= 0; index -= 1) closeGroup();',
      '}',
      '',
      'export function createLogger(baseOptions: LoggerOptions = {}, scopes: string[] = []): BrowserLogger {',
      '  const logger = (level: LogLevel) => (message: string, meta?: Record<string, unknown>) => {',
      '    write(level, scopes, message, meta, baseOptions);',
      '  };',
      '',
      '  return {',
      '    child(scope: string, options?: LoggerOptions) {',
      '      return createLogger({ ...baseOptions, ...options }, [...scopes, scope]);',
      '    },',
      '    debug: logger("debug"),',
      '    info: logger("info"),',
      '    warn: logger("warn"),',
      '    error: logger("error"),',
      '  };',
      '}',
      '',
      'const logger = createLogger();',
      'export default logger;',
      '```',
      '',
      '```md title="README.md"',
      '# Browser Child Logger',
      '',
      'A browser logger package inspired by structured backend loggers. It keeps browser logging readable with child loggers, console group nesting, and scoped module logging for packages or apps.',
      '',
      '## Features',
      '',
      '- Child loggers for nested scopes.',
      '- Console group rendering with either `console.group` or collapsed groups.',
      '- `collapse` and `groupByMessage` options for shaping output.',
      '- Works well when a package wants to expose an optional logger prop to consumers.',
      '',
      '## Example',
      '',
      'Create a logger, then call `child("my_module", { collapse: true, groupByMessage: true })` to scope browser output.',
      '```',
    ].join('\n');
  }

export function generateBuilderFrameworkAgnosticRouterLibrary(_desc: string): string {
    return [
      '```json title="package.json"',
      JSON.stringify({
        name: 'router-primitives-lite',
        version: '0.1.0',
        private: false,
        type: 'module',
        exports: {
          '.': './src/index.ts',
        },
      }, null, 2),
      '```',
      '',
      '```ts title="src/index.ts"',
      'export type RouteState = { path: string; params?: Record<string, string>; query?: Record<string, string> };',
      'export type LayoutPrimitive = { id: string; kind: "stack" | "scene" | "slot"; children?: LayoutPrimitive[] };',
      'export type RouteTemplate = (state: RouteState) => LayoutPrimitive;',
      'export type RouterDeclaration = Record<string, RouteTemplate>;',
      '',
      'export class Manager {',
      '  constructor(private readonly declaration: RouterDeclaration) {}',
      '',
      '  resolve(path: string): LayoutPrimitive | null {',
      '    const template = this.declaration[path];',
      '    if (!template) return null;',
      '    return template({ path });',
      '  }',
      '',
      '  listRoutes(): string[] {',
      '    return Object.keys(this.declaration);',
      '  }',
      '}',
      '',
      'export function scene(id: string, children: LayoutPrimitive[] = []): LayoutPrimitive {',
      '  return { id, kind: "scene", children };',
      '}',
      '',
      'export function stack(id: string, children: LayoutPrimitive[] = []): LayoutPrimitive {',
      '  return { id, kind: "stack", children };',
      '}',
      '',
      'export function slot(id: string): LayoutPrimitive {',
      '  return { id, kind: "slot" };',
      '}',
      '',
      'export const routerDeclaration: RouterDeclaration = {',
      '  "/": () => stack("root", [scene("home", [slot("content")])]),',
      '  "/settings": () => stack("root", [scene("settings", [slot("tabs"), slot("panel")])]),',
      '};',
      '```',
      '',
      '```md title="README.md"',
      '# Router Primitives Lite',
      '',
      'A framework agnostic application router library. Declarative routing by way of layout primitives keeps route state portable across frameworks while still giving you a Manager, router declarations, scene or stack primitives, and template support.',
      '',
      '## Core ideas',
      '',
      '- Framework agnostic: route state is plain data.',
      '- Layout primitives: compose scenes, stacks, and slots instead of hard-coding a renderer.',
      '- Manager: resolves a router declaration into a concrete layout tree.',
      '- Template support: each route can provide a template that maps route state into primitives.',
      '```',
    ].join('\n');
  }

export function generateBuilderPersonalCrmApp(desc: string): string {
    const pkg = JSON.stringify({
      name: 'personal-crm-workbench',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {
        '@vitejs/plugin-react': '^4.3.1',
        vite: '^5.4.10',
        typescript: '^5.6.3',
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      },
      devDependencies: {},
    }, null, 2);

    return [
      '```json title="package.json"',
      pkg,
      '```',
      '',
      '```html title="index.html"',
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <title>Personal CRM Workbench</title>',
      "    <script type=\"module\" src=\"/src/main.jsx\"></script>",
      '  </head>',
      '  <body>',
      '    <div id="root"></div>',
      '  </body>',
      '</html>',
      '```',
      '',
      '```jsx title="src/main.jsx"',
      "import React from 'react';",
      "import ReactDOM from 'react-dom/client';",
      "import App from './App.jsx';",
      "import './styles.css';",
      '',
      "ReactDOM.createRoot(document.getElementById('root')).render(",
      '  <React.StrictMode>',
      '    <App />',
      '  </React.StrictMode>,',
      ');',
      '```',
      '',
      '```jsx title="src/App.jsx"',
      "import { useMemo, useState } from 'react';",
      '',
      'const starterContacts = [',
      "  { id: 1, name: 'Mina Solvik', company: 'Northline Studio', status: 'Warm', last: 'Coffee chat yesterday', next: 'Send launch notes Friday', notes: 'Cares about calm dashboards and founder workflows.' },",
      "  { id: 2, name: 'Jon Viken', company: 'Fjord Labs', status: 'Hot', last: 'Asked for pricing deck', next: 'Follow up tomorrow morning', notes: 'Wants a small pilot with two teammates.' },",
      "  { id: 3, name: 'Ari Bell', company: 'Signal House', status: 'Cold', last: 'Met at demo night', next: 'Send useful benchmark writeup next week', notes: 'Interested, but timing is uncertain.' },",
      '];',
      '',
      'export default function App() {',
      '  const [contacts, setContacts] = useState(starterContacts);',
      "  const [filter, setFilter] = useState('All');",
      "  const [draft, setDraft] = useState({ name: '', company: '', notes: '' });",
      '',
      '  const visibleContacts = useMemo(() => {',
      "    return filter === 'All' ? contacts : contacts.filter((contact) => contact.status === filter);",
      '  }, [contacts, filter]);',
      '',
      '  const nextContact = useMemo(() => {',
      "    return contacts.find((contact) => contact.status === 'Hot') ?? contacts[0];",
      '  }, [contacts]);',
      '',
      '  function addContact(event) {',
      '    event.preventDefault();',
      '    if (!draft.name.trim()) return;',
      '    const created = {',
      '      id: Date.now(),',
      '      name: draft.name.trim(),',
      "      company: draft.company.trim() || 'Independent',",
      "      status: 'Warm',",
      "      last: 'Captured just now',",
      "      next: 'Write one personal follow-up today',",
      "      notes: draft.notes.trim() || 'New relationship captured from quick entry.',",
      '    };',
      '    setContacts((current) => [created, ...current]);',
      "    setDraft({ name: '', company: '', notes: '' });",
      '  }',
      '',
      '  function cycleStatus(id) {',
      "    const order = ['Cold', 'Warm', 'Hot'];",
      '    setContacts((current) => current.map((contact) => {',
      '      if (contact.id !== id) return contact;',
      '      const nextStatus = order[(order.indexOf(contact.status) + 1) % order.length];',
      '      return { ...contact, status: nextStatus };',
      '    }));',
      '  }',
      '',
      '  return (',
      "    <main className=\"crm-shell\">",
      "      <section className=\"top-band\">",
      '        <div>',
      "          <p className=\"eyebrow\">Personal CRM</p>",
      '          <h1>Relationship follow-ups without the spreadsheet fog.</h1>',
      '          <p className="lede">Track people, context, warmth, and the next honest touch. This first build includes seeded contacts, a quick capture form, status filters, notes, and next-contact suggestions.</p>',
      '        </div>',
      '        <aside className="next-panel">',
      '          <span>Next Contact</span>',
      '          <strong>{nextContact.name}</strong>',
      '          <p>{nextContact.next}</p>',
      '        </aside>',
      '      </section>',
      '',
      '      <section className="workspace-grid">',
      '        <form className="capture-panel" onSubmit={addContact}>',
      '          <div className="section-title">',
      '            <span>Quick Capture</span>',
      '            <strong>Add a relationship</strong>',
      '          </div>',
      '          <label>Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ada Nord" /></label>',
      '          <label>Company<input value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} placeholder="Studio or team" /></label>',
      '          <label>Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="What matters to them?" /></label>',
      '          <button type="submit">Capture contact</button>',
      '        </form>',
      '',
      '        <section className="contacts-panel">',
      '          <div className="toolbar">',
      '            <div className="section-title">',
      '              <span>Pipeline</span>',
      '              <strong>{visibleContacts.length} visible contacts</strong>',
      '            </div>',
      '            <div className="filters" role="group" aria-label="Filter contacts by status">',
      "              {['All', 'Hot', 'Warm', 'Cold'].map((item) => (",
      '                <button key={item} type="button" className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>',
      '              ))}',
      '            </div>',
      '          </div>',
      '          <div className="contact-list">',
      '            {visibleContacts.map((contact) => (',
      '              <article key={contact.id} className="contact-row">',
      '                <button type="button" className={`status ${contact.status.toLowerCase()}`} onClick={() => cycleStatus(contact.id)}>{contact.status}</button>',
      '                <div>',
      '                  <h2>{contact.name}</h2>',
      '                  <p>{contact.company}</p>',
      '                  <small>{contact.last}</small>',
      '                </div>',
      '                <div className="notes">',
      '                  <strong>{contact.next}</strong>',
      '                  <p>{contact.notes}</p>',
      '                </div>',
      '              </article>',
      '            ))}',
      '          </div>',
      '        </section>',
      '      </section>',
      '    </main>',
      '  );',
      '}',
      '```',
      '',
      '```css title="src/styles.css"',
      ':root {',
      '  color: #182024;',
      '  background: #f6f0e5;',
      "  font-family: 'Segoe UI', system-ui, sans-serif;",
      '}',
      '',
      '* { box-sizing: border-box; }',
      'body { margin: 0; min-height: 100vh; background: linear-gradient(135deg, #f6f0e5 0%, #e6f1ee 48%, #f2e5d2 100%); }',
      'button, input, textarea { font: inherit; }',
      '.crm-shell { width: min(1180px, calc(100% - 28px)); margin: 0 auto; padding: 26px 0 44px; }',
      '.top-band { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: stretch; margin-bottom: 18px; }',
      '.top-band > div, .next-panel, .capture-panel, .contacts-panel { border: 1px solid rgba(24, 32, 36, 0.12); background: rgba(255, 252, 246, 0.78); box-shadow: 0 22px 55px rgba(55, 46, 32, 0.12); }',
      '.top-band > div { padding: 30px; border-radius: 8px; }',
      '.eyebrow, .section-title span, .next-panel span, small { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.73rem; color: #69766f; }',
      'h1 { max-width: 10ch; margin: 0; font-size: clamp(3rem, 7vw, 5.8rem); line-height: 0.9; letter-spacing: 0; font-family: Georgia, serif; }',
      '.lede { max-width: 64ch; color: #59625d; line-height: 1.7; }',
      '.next-panel { border-radius: 8px; padding: 24px; display: grid; align-content: space-between; }',
      '.next-panel strong { font-size: 1.7rem; }',
      '.workspace-grid { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 18px; }',
      '.capture-panel, .contacts-panel { border-radius: 8px; padding: 18px; }',
      '.capture-panel { display: grid; gap: 14px; align-self: start; }',
      '.section-title { display: grid; gap: 4px; margin-bottom: 4px; }',
      '.section-title strong { font-size: 1.15rem; }',
      'label { display: grid; gap: 7px; font-size: 0.88rem; color: #44504a; }',
      'input, textarea { width: 100%; border: 1px solid rgba(24, 32, 36, 0.14); border-radius: 8px; padding: 12px; background: #fffdf8; color: #182024; }',
      'textarea { min-height: 116px; resize: vertical; }',
      '.capture-panel > button, .filters button, .status { border: 0; border-radius: 999px; padding: 10px 13px; cursor: pointer; }',
      '.capture-panel > button { background: #17201c; color: white; }',
      '.toolbar { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 14px; }',
      '.filters { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.filters button { background: rgba(24, 32, 36, 0.08); color: #2c3732; }',
      '.filters button.active { background: #17201c; color: white; }',
      '.contact-list { display: grid; gap: 12px; }',
      '.contact-row { display: grid; grid-template-columns: 86px minmax(150px, 0.8fr) minmax(220px, 1fr); gap: 15px; align-items: start; padding: 16px; border: 1px solid rgba(24, 32, 36, 0.1); border-radius: 8px; background: #fffdf8; }',
      '.contact-row h2 { margin: 0 0 5px; font-size: 1.18rem; }',
      '.contact-row p { margin: 0; color: #59625d; line-height: 1.55; }',
      '.status { color: #182024; font-weight: 700; }',
      '.status.hot { background: #ffcf8d; }',
      '.status.warm { background: #d8eadf; }',
      '.status.cold { background: #d6dde3; }',
      '.notes { display: grid; gap: 6px; }',
      '@media (max-width: 900px) { .top-band, .workspace-grid, .contact-row { grid-template-columns: 1fr; } h1 { max-width: 12ch; } }',
      '```',
      '',
      'Built as a preview-ready personal CRM workbench.',
    ].join('\n');
  }

export function generateBuilderSharedShoppingProductApp(_desc: string, upgrade: boolean): string {
    const pkg = JSON.stringify({
      name: 'shared-shopping-app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        'framer-motion': '^11.11.17',
      },
      devDependencies: {
        '@types/react': '^18.3.1',
        '@types/react-dom': '^18.3.1',
        '@vitejs/plugin-react': '^4.3.1',
        '@tailwindcss/vite': '^4.2.2',
        tailwindcss: '^4.2.2',
        typescript: '^5.5.3',
        vite: '^5.4.10',
      },
    }, null, 2);

    const headline = upgrade
      ? 'Shared Shopping List, tuned for the actual store run.'
      : 'Shared Shopping List';
    const intro = upgrade
      ? 'This iteration turns the preview into a tighter product surface: fast adding, bought-state feedback, substitutions, owner handoff, undo, and a store-run view that works on the same data.'
      : 'A household shopping workspace with a fast add lane, grouped groceries, owner context, bought-state actions, substitutions, undo, and live coordination in the same first screen.';

    return `\`\`\`json title="package.json"
${pkg}
\`\`\`

\`\`\`html title="index.html"
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Shared Shopping List</title>
    <script type="module" src="/src/main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
\`\`\`

\`\`\`ts title="vite.config.ts"
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
\`\`\`

\`\`\`tsx title="src/main.tsx"
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
\`\`\`

\`\`\`tsx title="src/App.tsx"
import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

type ViewMode = 'list' | 'run' | 'activity';
type Member = { name: string; role: string; status: string; color: string };
type ShoppingItem = {
  id: number;
  name: string;
  aisle: string;
  owner: string;
  priority: 'Tonight' | 'Need soon' | 'Weekly' | 'Refill';
  quantity: string;
  checked: boolean;
  note: string;
};
type Activity = { id: number; author: string; text: string; time: string };

const members: Member[] = [
  { name: 'Maya', role: 'Dinner run', status: 'In store now', color: 'mint' },
  { name: 'Jon', role: 'Pantry restock', status: 'Watching home stock', color: 'blue' },
  { name: 'Ari', role: 'Budget check', status: 'Reviews substitutions', color: 'amber' },
];

const starterItems: ShoppingItem[] = [
  { id: 1, name: 'Avocados', aisle: 'Produce', owner: 'Maya', priority: 'Need soon', quantity: '4', checked: false, note: 'Ripe but not soft. Swap for pears if all underripe.' },
  { id: 2, name: 'Baby spinach', aisle: 'Produce', owner: 'Maya', priority: 'Tonight', quantity: '2 bags', checked: false, note: 'For pasta and lunch wraps.' },
  { id: 3, name: 'Sparkling water', aisle: 'Drinks', owner: 'Jon', priority: 'Weekly', quantity: '12 pack', checked: false, note: 'Any lime flavor is fine.' },
  { id: 4, name: 'Chili crisp', aisle: 'Pantry', owner: 'Ari', priority: 'Refill', quantity: '1 jar', checked: true, note: 'Keep under the pantry budget.' },
  { id: 5, name: 'Greek yogurt', aisle: 'Dairy', owner: 'You', priority: 'Tonight', quantity: '1 tub', checked: false, note: 'Plain, full-fat.' },
];

const starterActivity: Activity[] = [
  { id: 1, author: 'Maya', text: 'Moved avocados to Need soon before the evening run.', time: '4m ago' },
  { id: 2, author: 'Jon', text: 'Sparkling water is still on the weekly stock list.', time: '12m ago' },
  { id: 3, author: 'Ari', text: 'Chili crisp is fine if it stays under budget.', time: '21m ago' },
];

const suggestions = ['Eggs', 'Coffee filters', 'Bananas', 'Dish soap'];
const aisleOptions = ['Produce', 'Dairy', 'Pantry', 'Drinks'];

export default function App() {
  const [items, setItems] = useState<ShoppingItem[]>(starterItems);
  const [activity, setActivity] = useState<Activity[]>(starterActivity);
  const [view, setView] = useState<ViewMode>('list');
  const [draft, setDraft] = useState('');
  const [draftAisle, setDraftAisle] = useState('Produce');
  const [activeId, setActiveId] = useState(1);
  const [removedItem, setRemovedItem] = useState<ShoppingItem | null>(null);
  const [activityDraft, setActivityDraft] = useState('');

  const activeItem = items.find((item) => item.id === activeId) ?? items[0];
  const openItems = items.filter((item) => !item.checked);
  const completedItems = items.filter((item) => item.checked);

  const groupedItems = useMemo(() => items.reduce<Record<string, ShoppingItem[]>>((groups, item) => {
    groups[item.aisle] ??= [];
    groups[item.aisle].push(item);
    return groups;
  }, {}), [items]);

  function pushActivity(text: string, author = 'You') {
    setActivity((current) => [{ id: Date.now(), author, text, time: 'just now' }, ...current].slice(0, 5));
  }

  function addItem(event?: FormEvent<HTMLFormElement>, quickName?: string) {
    event?.preventDefault();
    const name = (quickName ?? draft).trim();
    if (!name) return;
    const created: ShoppingItem = {
      id: Date.now(),
      name,
      aisle: draftAisle,
      owner: 'You',
      priority: 'Need soon',
      quantity: '1',
      checked: false,
      note: 'Added from quick capture. Tap the row to add notes or change priority.',
    };
    setItems((current) => [created, ...current]);
    setActiveId(created.id);
    setDraft('');
    pushActivity(\`Added \${name} to \${draftAisle}.\`);
  }

  function toggleBought(id: number) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, checked: !item.checked } : item));
    const item = items.find((entry) => entry.id === id);
    if (item) pushActivity(\`\${item.checked ? 'Returned' : 'Marked bought'}: \${item.name}.\`);
  }

  function cyclePriority(id: number) {
    const order: ShoppingItem['priority'][] = ['Tonight', 'Need soon', 'Weekly', 'Refill'];
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const nextPriority = order[(order.indexOf(item.priority) + 1) % order.length];
      return { ...item, priority: nextPriority };
    }));
  }

  function assignToMe(id: number) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, owner: 'You' } : item));
    const item = items.find((entry) => entry.id === id);
    if (item) pushActivity(\`You took ownership of \${item.name}.\`);
  }

  function replaceItem(id: number) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, name: \`\${item.name} substitute\`, priority: 'Tonight', owner: 'You' } : item));
    const item = items.find((entry) => entry.id === id);
    if (item) pushActivity(\`Added a substitute option for \${item.name}.\`);
  }

  function removeItem(id: number) {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    setRemovedItem(item);
    setItems((current) => current.filter((entry) => entry.id !== id));
    pushActivity(\`Removed \${item.name}; undo is available.\`);
  }

  function undoRemove() {
    if (!removedItem) return;
    setItems((current) => [removedItem, ...current]);
    setActiveId(removedItem.id);
    pushActivity(\`Restored \${removedItem.name}.\`);
    setRemovedItem(null);
  }

  function sendActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = activityDraft.trim();
    if (!text) return;
    pushActivity(text);
    setActivityDraft('');
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div className="brand-block">
          <span className="app-label">Household shopping workspace</span>
          <h1>${headline}</h1>
          <p>${intro}</p>
        </div>

        <form className="quick-add" onSubmit={(event) => addItem(event)}>
          <label htmlFor="quick-item">Quick add</label>
          <div className="quick-add-row">
            <input id="quick-item" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Milk, limes, detergent..." />
            <select value={draftAisle} onChange={(event) => setDraftAisle(event.target.value)} aria-label="Choose aisle">
              {aisleOptions.map((aisle) => <option key={aisle}>{aisle}</option>)}
            </select>
            <button type="submit">Add item</button>
          </div>
          <div className="suggestions" aria-label="Quick suggestions">
            {suggestions.map((name) => <button key={name} type="button" onClick={() => addItem(undefined, name)}>{name}</button>)}
          </div>
        </form>
      </section>

      <nav className="mode-tabs" aria-label="Shopping views">
        <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>List</button>
        <button className={view === 'run' ? 'active' : ''} onClick={() => setView('run')}>Store Run</button>
        <button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}>Activity Chat</button>
      </nav>

      <div className="workspace">
        <aside className="household-panel">
          <div className="panel-heading">
            <span>Household</span>
            <strong>{members.length} active</strong>
          </div>
          {members.map((member) => (
            <article key={member.name} className={\`member-card \${member.color}\`}>
              <div>
                <strong>{member.name}</strong>
                <span>{member.role}</span>
              </div>
              <em>{member.status}</em>
            </article>
          ))}
          {removedItem && <button className="undo-button" onClick={undoRemove}>Undo remove {removedItem.name}</button>}
        </aside>

        <section className="main-panel">
          <AnimatePresence mode="wait">
            {view === 'list' && (
              <motion.div key="list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="list-view">
                <div className="section-title">
                  <div>
                    <span>Shared Shopping List</span>
                    <h2>{openItems.length} to buy · {completedItems.length} bought</h2>
                  </div>
                  <button onClick={() => setItems((current) => current.map((item) => ({ ...item, checked: false })))}>Reset bought</button>
                </div>

                {Object.entries(groupedItems).map(([aisle, aisleItems]) => (
                  <section key={aisle} className="aisle-section">
                    <header>
                      <span>{aisle}</span>
                      <small>{aisleItems.filter((item) => !item.checked).length} open</small>
                    </header>
                    <div className="item-stack">
                      {aisleItems.map((item) => (
                        <article key={item.id} className={\`item-row \${item.checked ? 'checked' : ''} \${activeId === item.id ? 'selected' : ''}\`} onClick={() => setActiveId(item.id)}>
                          <button className="check-button" onClick={(event) => { event.stopPropagation(); toggleBought(item.id); }}>{item.checked ? 'Bought' : 'Mark bought'}</button>
                          <div className="item-copy">
                            <strong>{item.name}</strong>
                            <span>{item.quantity} · added by {item.owner} · {item.priority}</span>
                          </div>
                          <div className="item-actions">
                            <button onClick={(event) => { event.stopPropagation(); cyclePriority(item.id); }}>Priority</button>
                            <button onClick={(event) => { event.stopPropagation(); assignToMe(item.id); }}>Assign me</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </motion.div>
            )}

            {view === 'run' && (
              <motion.div key="run" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="run-view">
                <div className="section-title">
                  <div>
                    <span>Store Run</span>
                    <h2>Route by aisle, not by card</h2>
                  </div>
                  <button onClick={() => pushActivity('Store run exported to the household thread.')}>Share route</button>
                </div>
                <div className="route-list">
                  {Object.entries(groupedItems).map(([aisle, aisleItems], index) => (
                    <article key={aisle} className="route-stop">
                      <b>{index + 1}</b>
                      <div>
                        <strong>{aisle}</strong>
                        <span>{aisleItems.filter((item) => !item.checked).map((item) => item.name).join(', ') || 'All bought'}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </motion.div>
            )}

            {view === 'activity' && (
              <motion.div key="activity" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="activity-view">
                <div className="section-title">
                  <div>
                    <span>Activity Chat</span>
                    <h2>Coordination that stays near the list</h2>
                  </div>
                </div>
                <div className="activity-stack">
                  {activity.map((entry) => (
                    <article key={entry.id} className="activity-card">
                      <strong>{entry.author}</strong>
                      <p>{entry.text}</p>
                      <time>{entry.time}</time>
                    </article>
                  ))}
                </div>
                <form className="activity-compose" onSubmit={sendActivity}>
                  <input value={activityDraft} onChange={(event) => setActivityDraft(event.target.value)} placeholder="Ask for a substitute, say you grabbed it..." />
                  <button type="submit">Send update</button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <aside className="detail-panel">
          <div className="panel-heading">
            <span>Item detail</span>
            <strong>{activeItem?.priority ?? 'Ready'}</strong>
          </div>
          {activeItem ? (
            <>
              <h2>{activeItem.name}</h2>
              <p>{activeItem.note}</p>
              <dl>
                <div><dt>Aisle</dt><dd>{activeItem.aisle}</dd></div>
                <div><dt>Quantity</dt><dd>{activeItem.quantity}</dd></div>
                <div><dt>Owner</dt><dd>{activeItem.owner}</dd></div>
              </dl>
              <div className="detail-actions">
                <button onClick={() => toggleBought(activeItem.id)}>{activeItem.checked ? 'Return to list' : 'Mark bought'}</button>
                <button onClick={() => replaceItem(activeItem.id)}>Suggest substitute</button>
                <button className="danger" onClick={() => removeItem(activeItem.id)}>Remove</button>
              </div>
            </>
          ) : (
            <p>No item selected.</p>
          )}
        </aside>
      </div>
    </main>
  );
}
\`\`\`

\`\`\`css title="src/styles.css"
@import 'tailwindcss';

:root {
  color-scheme: dark;
  font-family: ui-sans-serif, 'Segoe UI Variable Text', 'Aptos', system-ui, sans-serif;
  background: #0b1110;
  color: #eef7f2;
}

* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background:
  radial-gradient(circle at 18% -10%, rgba(94, 234, 212, 0.16), transparent 35%),
  linear-gradient(135deg, #07100e 0%, #101917 46%, #15120f 100%);
}
button, input, select { font: inherit; }
button { cursor: pointer; }

.app-shell { width: min(1440px, calc(100% - 32px)); margin: 0 auto; padding: 18px 0 28px; }
.topbar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 520px); gap: 14px; align-items: stretch; }
.brand-block, .quick-add, .household-panel, .main-panel, .detail-panel { border: 1px solid rgba(226, 255, 244, 0.1); background: rgba(10, 22, 19, 0.78); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.24); }
.brand-block { padding: 22px; min-height: 178px; display: grid; align-content: center; }
.app-label, .panel-heading span, .section-title span { color: #75f0ce; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; }
h1 { margin: 8px 0 10px; font-size: clamp(2rem, 4vw, 3.7rem); line-height: 0.98; letter-spacing: 0; }
p { color: #abc1b8; line-height: 1.6; }
.quick-add { padding: 16px; display: grid; gap: 12px; }
.quick-add label { color: #d8fff2; font-weight: 800; }
.quick-add-row { display: grid; grid-template-columns: minmax(0, 1fr) 122px 120px; gap: 8px; }
input, select { min-height: 44px; border: 1px solid rgba(226, 255, 244, 0.12); background: rgba(239, 255, 249, 0.06); color: #f4fffb; padding: 0 12px; outline: none; }
select option { color: #10201b; }
input:focus, select:focus { border-color: #75f0ce; box-shadow: 0 0 0 3px rgba(117, 240, 206, 0.16); }
button { border: 0; background: rgba(226, 255, 244, 0.08); color: #e9fff7; min-height: 38px; padding: 0 12px; font-weight: 750; transition: transform 160ms ease, background 160ms ease, color 160ms ease; }
button:hover { transform: translateY(-1px); background: rgba(226, 255, 244, 0.14); }
.quick-add-row button, .activity-compose button, .detail-actions button:first-child { background: #75f0ce; color: #07100e; }
.suggestions { display: flex; flex-wrap: wrap; gap: 8px; }
.suggestions button { min-height: 32px; color: #bfeee0; }
.mode-tabs { display: flex; gap: 8px; padding: 12px 0; overflow-x: auto; }
.mode-tabs button { min-width: 120px; border: 1px solid rgba(226, 255, 244, 0.1); }
.mode-tabs button.active { background: #75f0ce; color: #07100e; }
.workspace { display: grid; grid-template-columns: 280px minmax(0, 1fr) 340px; gap: 14px; align-items: start; }
.household-panel, .main-panel, .detail-panel { padding: 16px; min-height: 260px; }
.panel-heading, .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: start; margin-bottom: 14px; }
.panel-heading strong { color: #f2d38b; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.12em; }
.member-card { display: grid; gap: 10px; padding: 14px; margin-bottom: 10px; border: 1px solid rgba(226, 255, 244, 0.1); background: rgba(226, 255, 244, 0.04); }
.member-card strong, .item-copy strong, .route-stop strong, .detail-panel h2 { color: #ffffff; }
.member-card span, .item-copy span, .route-stop span { display: block; color: #9fb7ae; margin-top: 4px; }
.member-card em { color: #75f0ce; font-style: normal; font-size: 0.82rem; }
.member-card.blue em { color: #96d3ff; }
.member-card.amber em { color: #f2d38b; }
.undo-button { width: 100%; margin-top: 8px; background: rgba(242, 211, 139, 0.18); color: #ffe7a5; }
.section-title h2 { margin: 4px 0 0; color: #f7fffb; font-size: 1.15rem; }
.aisle-section { margin-bottom: 14px; border: 1px solid rgba(226, 255, 244, 0.1); background: rgba(226, 255, 244, 0.035); }
.aisle-section header { display: flex; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid rgba(226, 255, 244, 0.08); }
.aisle-section header span { color: #75f0ce; font-weight: 850; }
.aisle-section small { color: #8aa69d; }
.item-stack { display: grid; }
.item-row { display: grid; grid-template-columns: 104px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px 14px; border-bottom: 1px solid rgba(226, 255, 244, 0.07); }
.item-row:last-child { border-bottom: 0; }
.item-row.selected { background: rgba(117, 240, 206, 0.08); }
.item-row.checked { opacity: 0.64; }
.check-button { background: rgba(117, 240, 206, 0.12); color: #9af7dc; }
.item-actions { display: flex; gap: 8px; }
.item-actions button { min-height: 34px; color: #cfece2; }
.route-list, .activity-stack { display: grid; gap: 10px; }
.route-stop { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 12px; align-items: center; padding: 14px; border: 1px solid rgba(226, 255, 244, 0.1); background: rgba(226, 255, 244, 0.04); }
.route-stop b { display: grid; place-items: center; width: 38px; height: 38px; background: #75f0ce; color: #07100e; }
.activity-card { padding: 14px; border: 1px solid rgba(226, 255, 244, 0.1); background: rgba(226, 255, 244, 0.04); }
.activity-card p { margin: 6px 0; }
.activity-card time { color: #75f0ce; font-size: 0.8rem; }
.activity-compose { display: grid; grid-template-columns: minmax(0, 1fr) 120px; gap: 8px; margin-top: 12px; }
.detail-panel { position: sticky; top: 18px; }
.detail-panel h2 { margin: 0 0 8px; font-size: 1.8rem; }
dl { display: grid; gap: 8px; margin: 18px 0; }
dl div { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid rgba(226, 255, 244, 0.08); padding-bottom: 8px; }
dt { color: #8aa69d; }
dd { margin: 0; color: #f7fffb; font-weight: 800; }
.detail-actions { display: grid; gap: 8px; }
.detail-actions .danger { color: #ffc4b8; background: rgba(255, 117, 91, 0.14); }

@media (max-width: 1080px) {
  .topbar, .workspace { grid-template-columns: 1fr; }
  .detail-panel { position: static; }
}

@media (max-width: 720px) {
  .app-shell { width: min(100%, calc(100% - 20px)); padding-top: 10px; }
  .quick-add-row, .item-row, .activity-compose { grid-template-columns: 1fr; }
  .item-actions { flex-wrap: wrap; }
  h1 { font-size: 2.25rem; }
}
\`\`\`

\`\`\`json title="tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
\`\`\``;
  }

export function generateBuilderSharedShoppingLegacyApp(desc: string): string {
    const pkg = JSON.stringify({
      name: 'shared-shopping-app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        'framer-motion': '^11.11.17',
      },
      devDependencies: {
        '@types/react': '^18.3.1',
        '@types/react-dom': '^18.3.1',
        '@vitejs/plugin-react': '^4.3.1',
        '@tailwindcss/vite': '^4.2.2',
        tailwindcss: '^4.2.2',
        typescript: '^5.5.3',
        vite: '^5.4.10',
      },
    }, null, 2);

    return `\`\`\`json title="package.json"
${pkg}
\`\`\`

\`\`\`html title="index.html"
<!doctype html>
<html lang='en'>
  <head>
    <meta charset='UTF-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1.0' />
    <title>Shared Shopping List</title>
    <script type='module' src='/src/main.tsx'></script>
  </head>
  <body>
    <div id='root'></div>
  </body>
</html>
\`\`\`

\`\`\`ts title="vite.config.ts"
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
\`\`\`

\`\`\`tsx title="src/main.tsx"
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
\`\`\`

\`\`\`tsx title="src/App.tsx"
import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';

type Member = { name: string; role: string; badge: string };
type ShoppingItem = { id: number; name: string; aisle: string; owner: string; priority: string; quantity: string };

const members = [
  { name: 'Maya', role: 'Meal prep', badge: 'On store run' },
  { name: 'Jon', role: 'Restock', badge: 'At home' },
  { name: 'Ari', role: 'Budget', badge: 'Reviewing totals' },
] satisfies Member[];

const starterItems = [
  { id: 1, name: 'Avocados', aisle: 'Produce', owner: 'Maya', priority: 'Need soon', quantity: '4' },
  { id: 2, name: 'Sparkling water', aisle: 'Drinks', owner: 'Jon', priority: 'Weekly', quantity: '12' },
  { id: 3, name: 'Chili crisp', aisle: 'Pantry', owner: 'Ari', priority: 'Refill', quantity: '1' },
  { id: 4, name: 'Baby spinach', aisle: 'Produce', owner: 'Maya', priority: 'Tonight', quantity: '2 bags' },
] satisfies ShoppingItem[];

const activityFeed = [
  'Maya moved avocados to Need soon before the evening run.',
  'Jon said sparkling water is still on the weekly stock list.',
  'Ari wants chili crisp kept under the pantry budget this week.',
];

export default function App() {
  const [items, setItems] = useState(starterItems);
  const [draft, setDraft] = useState('');

  const groupedItems = useMemo(() => items.reduce<Record<string, ShoppingItem[]>>((acc, item) => {
    acc[item.aisle] ??= [];
    acc[item.aisle].push(item);
    return acc;
  }, {}), [items]);

  const storeRun = useMemo(() => Object.entries(groupedItems).map(([aisle, aisleItems]) => ({
    aisle,
    picks: aisleItems.map((item) => item.name).join(', '),
  })), [groupedItems]);

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = draft.trim();
    if (!nextName) return;
    setItems((current) => [{
      id: current.length + 1,
      name: nextName,
      aisle: 'Produce',
      owner: 'You',
      priority: 'Need soon',
      quantity: '1',
    }, ...current]);
    setDraft('');
  }

  return (
    <main className='min-h-screen bg-[#0b1412] text-stone-100'>
      <div className='mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-5 md:px-8'>
        <motion.header initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className='grid gap-4 border border-white/10 bg-[#0f1b17] p-5 xl:grid-cols-[1.15fr_0.85fr]'>
          <div>
            <p className='text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-emerald-300'>Shared shopping workspace</p>
            <h1 className='mt-2 text-4xl font-semibold tracking-tight text-stone-50 sm:text-5xl'>Shared Shopping List</h1>
            <p className='mt-3 max-w-2xl text-sm leading-6 text-stone-300 sm:text-base'>Built for Tonight\'s store run: household context on one side, aisle-first list in the middle, and a route-ready store plan that feels like a product instead of a dashboard.</p>
          </div>

          <form onSubmit={addItem} className='grid gap-3 border border-white/10 bg-[#09100d] p-4'>
            <div>
              <div className='text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-stone-400'>Quick add</div>
              <div className='mt-1 text-lg font-medium text-stone-100'>Add the next item before it slips</div>
            </div>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder='Quick-add milk, limes, detergent...'
              className='w-full border border-white/10 bg-[#111c18] px-4 py-3 text-sm text-stone-100 outline-none placeholder:text-stone-500'
            />
            <button className='bg-emerald-300 px-4 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200'>Quick-add item</button>
          </form>
        </motion.header>

        <div className='grid gap-4 xl:grid-cols-[1.35fr_0.9fr]'>
          <section className='space-y-4'>
            <motion.article initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className='border border-white/10 bg-[#0f1b17] p-5'>
              <div className='mb-4 flex items-center justify-between gap-3'>
                <h2 className='text-lg font-semibold text-stone-50'>Household</h2>
                <span className='text-xs uppercase tracking-[0.24em] text-emerald-300'>3 active</span>
              </div>
              <div className='divide-y divide-white/10'>
                {members.map((member) => (
                  <div key={member.name} className='flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0'>
                    <div>
                      <div className='font-medium text-stone-100'>{member.name}</div>
                      <div className='text-sm text-stone-400'>{member.role}</div>
                    </div>
                    <span className='border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200'>{member.badge}</span>
                  </div>
                ))}
              </div>
            </motion.article>

            <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className='space-y-4'>
              <div className='flex items-center justify-between gap-3'>
                <h2 className='text-lg font-semibold text-stone-50'>Shared Shopping List</h2>
                <span className='text-xs uppercase tracking-[0.24em] text-stone-400'>{items.length} live items</span>
              </div>

              {Object.entries(groupedItems).map(([aisle, aisleItems], index) => (
                <motion.section key={aisle} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 + index * 0.05 }} className='border-l-4 border-emerald-300 bg-stone-50 p-4 text-stone-900 shadow-[0_18px_45px_rgba(0,0,0,0.22)]'>
                  <div className='mb-3 flex items-center justify-between gap-3 border-b border-stone-200 pb-3'>
                    <h3 className='text-sm font-semibold uppercase tracking-[0.24em] text-stone-500'>{aisle}</h3>
                    <span className='text-xs text-stone-400'>Aisle grouping</span>
                  </div>
                  <div className='grid gap-3'>
                    {aisleItems.map((item) => (
                      <div key={item.id} className='grid gap-2 border-b border-stone-200 pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[1fr_auto] sm:items-center'>
                        <div>
                          <div className='font-semibold text-stone-900'>{item.name}</div>
                          <div className='text-xs uppercase tracking-[0.18em] text-stone-500'>Added by {item.owner} · {item.priority}</div>
                        </div>
                        <span className='text-sm font-medium text-stone-700'>{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </motion.section>
              ))}
            </motion.section>
          </section>

          <aside className='space-y-4'>
            <motion.article initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className='border border-white/10 bg-[#0f1b17] p-5'>
              <div className='mb-4 flex items-center justify-between gap-3'>
                <h2 className='text-lg font-semibold text-stone-50'>Activity Chat</h2>
                <span className='text-xs uppercase tracking-[0.24em] text-amber-300'>Live context</span>
              </div>
              <div className='space-y-3'>
                {activityFeed.map((entry) => (
                  <div key={entry} className='border border-white/10 bg-[#111c18] p-4 text-sm leading-6 text-stone-300'>{entry}</div>
                ))}
              </div>
            </motion.article>

            <motion.article initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} className='border border-emerald-300/20 bg-emerald-300/8 p-5'>
              <div className='mb-3 flex items-center justify-between gap-3'>
                <h2 className='text-lg font-semibold text-stone-50'>Store Run</h2>
                <span className='text-xs uppercase tracking-[0.24em] text-emerald-200'>Route ready</span>
              </div>
              <div className='space-y-3'>
                {storeRun.map((stop) => (
                  <div key={stop.aisle} className='border border-white/10 bg-[#0e1714] p-4'>
                    <div className='text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200'>{stop.aisle}</div>
                    <div className='mt-2 text-sm leading-6 text-stone-200'>{stop.picks}</div>
                  </div>
                ))}
              </div>
            </motion.article>
          </aside>
        </div>
      </div>
    </main>
  );
}
\`\`\`

\`\`\`css title="src/styles.css"
@import 'tailwindcss';

:root {
  color-scheme: dark;
  font-family: 'Segoe UI Variable Text', 'Trebuchet MS', sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at top, rgba(52, 211, 153, 0.18), transparent 30%),
    linear-gradient(180deg, #09110f 0%, #0b1412 48%, #070d0b 100%);
}
\`\`\`

\`\`\`json title="tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
\`\`\``;
  }

export function generateBuilderSharedShoppingLegacyUpgrade(_desc: string): string {
    return `\`\`\`jsx title="src/App.jsx"
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';

const members = [
  { name: 'Maya', role: 'Meal prep', badge: 'On store run' },
  { name: 'Jon', role: 'Restock', badge: 'At home' },
  { name: 'Ari', role: 'Budget', badge: 'Reviewing totals' },
];

const starterItems = [
  { id: 1, name: 'Avocados', aisle: 'Produce', owner: 'Maya', priority: 'Need soon', quantity: '4' },
  { id: 2, name: 'Sparkling water', aisle: 'Drinks', owner: 'Jon', priority: 'Weekly', quantity: '12' },
  { id: 3, name: 'Chili crisp', aisle: 'Pantry', owner: 'Ari', priority: 'Refill', quantity: '1' },
  { id: 4, name: 'Baby spinach', aisle: 'Produce', owner: 'Maya', priority: 'Tonight', quantity: '2 bags' },
];

const activityFeed = [
  'Maya moved avocados to Need soon before the evening run.',
  'Jon said sparkling water is still on the weekly stock list.',
  'Ari wants chili crisp kept under the pantry budget this week.',
];

export default function App() {
  const [items, setItems] = useState(starterItems);
  const [draft, setDraft] = useState('');

  const groupedItems = useMemo(() => items.reduce((acc, item) => {
    acc[item.aisle] ??= [];
    acc[item.aisle].push(item);
    return acc;
  }, {}), [items]);

  const storeRun = useMemo(() => Object.entries(groupedItems).map(([aisle, aisleItems]) => ({
    aisle,
    picks: aisleItems.map((item) => item.name).join(', '),
  })), [groupedItems]);

  function addItem(event) {
    event.preventDefault();
    const nextName = draft.trim();
    if (!nextName) return;
    setItems((current) => [{
      id: current.length + 1,
      name: nextName,
      aisle: 'Produce',
      owner: 'You',
      priority: 'Need soon',
      quantity: '1',
    }, ...current]);
    setDraft('');
  }

  return (
    <main className='min-h-screen bg-[#0b1412] text-stone-100'>
      <div className='mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-5 md:px-8'>
        <motion.header initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className='grid gap-4 border border-white/10 bg-[#0f1b17] p-5 xl:grid-cols-[1.15fr_0.85fr]'>
          <div>
            <p className='text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-emerald-300'>Upgraded household sync</p>
            <h1 className='mt-2 text-4xl font-semibold tracking-tight text-stone-50 sm:text-5xl'>Shared Shopping List</h1>
            <p className='mt-3 max-w-2xl text-sm leading-6 text-stone-300 sm:text-base'>The list is grouped by aisle, the route is ready, and the household context stays visible while the runner moves through the store.</p>
          </div>

          <form onSubmit={addItem} className='grid gap-3 border border-white/10 bg-[#09100d] p-4'>
            <div>
              <div className='text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-stone-400'>Quick add</div>
              <div className='mt-1 text-lg font-medium text-stone-100'>Add the next item before it slips</div>
            </div>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder='Quick-add milk, limes, detergent...'
              className='w-full border border-white/10 bg-[#111c18] px-4 py-3 text-sm text-stone-100 outline-none placeholder:text-stone-500'
            />
            <button className='bg-emerald-300 px-4 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200'>Quick-add item</button>
          </form>
        </motion.header>

        <div className='grid gap-4 xl:grid-cols-[1.35fr_0.9fr]'>
          <section className='space-y-4'>
            <motion.article initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className='border border-white/10 bg-[#0f1b17] p-5'>
              <div className='mb-4 flex items-center justify-between gap-3'>
                <h2 className='text-lg font-semibold text-stone-50'>Household</h2>
                <span className='text-xs uppercase tracking-[0.24em] text-emerald-300'>3 active</span>
              </div>
              <div className='divide-y divide-white/10'>
                {members.map((member) => (
                  <div key={member.name} className='flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0'>
                    <div>
                      <div className='font-medium text-stone-100'>{member.name}</div>
                      <div className='text-sm text-stone-400'>{member.role}</div>
                    </div>
                    <span className='border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200'>{member.badge}</span>
                  </div>
                ))}
              </div>
            </motion.article>

            <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className='space-y-4'>
              <div className='flex items-center justify-between gap-3'>
                <h2 className='text-lg font-semibold text-stone-50'>Shared Shopping List</h2>
                <span className='text-xs uppercase tracking-[0.24em] text-stone-400'>{items.length} live items</span>
              </div>

              {Object.entries(groupedItems).map(([aisle, aisleItems], index) => (
                <motion.section key={aisle} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 + index * 0.05 }} className='border-l-4 border-emerald-300 bg-stone-50 p-4 text-stone-900 shadow-[0_18px_45px_rgba(0,0,0,0.22)]'>
                  <div className='mb-3 flex items-center justify-between gap-3 border-b border-stone-200 pb-3'>
                    <h3 className='text-sm font-semibold uppercase tracking-[0.24em] text-stone-500'>{aisle}</h3>
                    <span className='text-xs text-stone-400'>Aisle grouping</span>
                  </div>
                  <div className='grid gap-3'>
                    {aisleItems.map((item) => (
                      <div key={item.id} className='grid gap-2 border-b border-stone-200 pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[1fr_auto] sm:items-center'>
                        <div>
                          <div className='font-semibold text-stone-900'>{item.name}</div>
                          <div className='text-xs uppercase tracking-[0.18em] text-stone-500'>Added by {item.owner} · {item.priority}</div>
                        </div>
                        <span className='text-sm font-medium text-stone-700'>{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </motion.section>
              ))}
            </motion.section>
          </section>

          <aside className='space-y-4'>
            <motion.article initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className='border border-white/10 bg-[#0f1b17] p-5'>
              <div className='mb-4 flex items-center justify-between gap-3'>
                <h2 className='text-lg font-semibold text-stone-50'>Activity Chat</h2>
                <span className='text-xs uppercase tracking-[0.24em] text-amber-300'>Live context</span>
              </div>
              <div className='space-y-3'>
                {activityFeed.map((entry) => (
                  <div key={entry} className='border border-white/10 bg-[#111c18] p-4 text-sm leading-6 text-stone-300'>{entry}</div>
                ))}
              </div>
            </motion.article>

            <motion.article initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} className='border border-emerald-300/20 bg-emerald-300/8 p-5'>
              <div className='mb-3 flex items-center justify-between gap-3'>
                <h2 className='text-lg font-semibold text-stone-50'>Store Run</h2>
                <span className='text-xs uppercase tracking-[0.24em] text-emerald-200'>Route ready</span>
              </div>
              <div className='space-y-3'>
                {storeRun.map((stop) => (
                  <div key={stop.aisle} className='border border-white/10 bg-[#0e1714] p-4'>
                    <div className='text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200'>{stop.aisle}</div>
                    <div className='mt-2 text-sm leading-6 text-stone-200'>{stop.picks}</div>
                  </div>
                ))}
              </div>
            </motion.article>
          </aside>
        </div>
      </div>
    </main>
  );
}
\`\`\``;
  }

export function generateBuilderMusicApp(_desc: string): string {
    return (
      'Building a music player app (Spotify-style UI).\n\n' +
      '```json title="package.json"\n' +
      '{\n  "name": "music-player",\n  "private": true,\n  "version": "0.0.0",\n  "type": "module",\n  "scripts": { "dev": "vite", "build": "vite build" },\n  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },\n  "devDependencies": { "@types/react": "^18", "@vitejs/plugin-react": "^4.3.1", "vite": "^5.4.1" }\n}\n' +
      '```\n\n' +
      '```tsx title="src/App.tsx"\n' +
      '\'use client\';\nimport { useState } from \'react\';\n\nconst playlist = [\n  { id: 1, title: \'Midnight Drive\', artist: \'Neon Pulse\', duration: \'3:42\', color: \'#6366f1\' },\n  { id: 2, title: \'Ocean Waves\', artist: \'Chill Mode\', duration: \'4:15\', color: \'#06b6d4\' },\n  { id: 3, title: \'City Lights\', artist: \'Urban Groove\', duration: \'3:58\', color: \'#f59e0b\' },\n  { id: 4, title: \'Sunrise\', artist: \'Ambient Works\', duration: \'5:02\', color: \'#10b981\' },\n  { id: 5, title: \'Electric Storm\', artist: \'Bass Theory\', duration: \'3:27\', color: \'#ec4899\' },\n];\n\nexport default function MusicPlayer() {\n  const [current, setCurrent] = useState(playlist[0]);\n  const [playing, setPlaying] = useState(false);\n  const [volume, setVolume] = useState(70);\n  const [progress, setProgress] = useState(35);\n\n  const prev = () => setCurrent(p => playlist[(playlist.indexOf(p) - 1 + playlist.length) % playlist.length]);\n  const next = () => setCurrent(p => playlist[(playlist.indexOf(p) + 1) % playlist.length]);\n\n  return (\n    <div style={{ display: \'flex\', height: \'100vh\', background: \'#121212\', color: \'#fff\', fontFamily: \'Inter, sans-serif\' }}>\n      {/* Sidebar */}\n      <aside style={{ width: 260, background: \'#000\', padding: 24, display: \'flex\', flexDirection: \'column\', gap: 8 }}>\n        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 24, color: current.color }}>♪ MusicApp</div>\n        {[\'Home\', \'Search\', \'Library\'].map(nav => (\n          <div key={nav} style={{ padding: \'10px 12px\', borderRadius: 6, cursor: \'pointer\', color: \'#b3b3b3\', fontSize: 14, fontWeight: 600 }}>{nav}</div>\n        ))}\n        <div style={{ marginTop: 24, fontSize: 12, fontWeight: 700, color: \'#b3b3b3\', letterSpacing: 1, marginBottom: 8 }}>PLAYLIST</div>\n        {playlist.map(track => (\n          <div key={track.id} onClick={() => { setCurrent(track); setPlaying(true); }}\n            style={{ padding: \'10px 12px\', borderRadius: 6, cursor: \'pointer\', background: current.id === track.id ? \'#282828\' : \'transparent\', borderLeft: current.id === track.id ? `3px solid ${track.color}` : \'3px solid transparent\' }}>\n            <div style={{ fontSize: 14, fontWeight: 600, color: current.id === track.id ? \'#fff\' : \'#b3b3b3\' }}>{track.title}</div>\n            <div style={{ fontSize: 12, color: \'#6b7280\' }}>{track.artist}</div>\n          </div>\n        ))}\n      </aside>\n\n      {/* Main */}\n      <main style={{ flex: 1, display: \'flex\', flexDirection: \'column\', alignItems: \'center\', justifyContent: \'center\', gap: 32 }}>\n        <div style={{ width: 220, height: 220, borderRadius: 16, background: `linear-gradient(135deg, ${current.color}, #000)`, display: \'flex\', alignItems: \'center\', justifyContent: \'center\', fontSize: 72, boxShadow: `0 32px 80px ${current.color}66` }}>♪</div>\n        <div style={{ textAlign: \'center\' }}>\n          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{current.title}</h2>\n          <p style={{ color: \'#b3b3b3\', fontSize: 16 }}>{current.artist}</p>\n        </div>\n        {/* Progress bar */}\n        <div style={{ width: 360 }}>\n          <input type="range" value={progress} onChange={e => setProgress(+e.target.value)} style={{ width: \'100%\', accentColor: current.color }}/>\n          <div style={{ display: \'flex\', justifyContent: \'space-between\', fontSize: 12, color: \'#6b7280\', marginTop: 4 }}><span>1:{String(Math.floor(progress / 100 * 42)).padStart(2,\'0\')}</span><span>{current.duration}</span></div>\n        </div>\n        {/* Controls */}\n        <div style={{ display: \'flex\', alignItems: \'center\', gap: 24 }}>\n          <button onClick={prev} style={{ background: \'none\', border: \'none\', color: \'#b3b3b3\', fontSize: 20, cursor: \'pointer\' }}>⏮</button>\n          <button onClick={() => setPlaying(p => !p)} style={{ background: current.color, border: \'none\', borderRadius: \'50%\', width: 56, height: 56, fontSize: 22, cursor: \'pointer\', color: \'#fff\', display: \'flex\', alignItems: \'center\', justifyContent: \'center\' }}>{playing ? \'⏸\' : \'▶\'}</button>\n          <button onClick={next} style={{ background: \'none\', border: \'none\', color: \'#b3b3b3\', fontSize: 20, cursor: \'pointer\' }}>⏭</button>\n        </div>\n        {/* Volume */}\n        <div style={{ display: \'flex\', alignItems: \'center\', gap: 12, color: \'#b3b3b3\', fontSize: 14 }}>\n          <span>🔈</span>\n          <input type="range" value={volume} onChange={e => setVolume(+e.target.value)} style={{ width: 120, accentColor: current.color }}/>\n          <span>🔊</span>\n        </div>\n      </main>\n    </div>\n  );\n}\n' +
      '```\n\n' +
      '```tsx title="src/main.tsx"\nimport React from \'react\';\nimport ReactDOM from \'react-dom/client\';\nimport App from \'./App\';\nReactDOM.createRoot(document.getElementById(\'root\') as HTMLElement).render(<React.StrictMode><App/></React.StrictMode>);\n```\n\n' +
      '```html title="index.html"\n<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Music Player</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n```\n\n' +
      '```js title="vite.config.js"\nimport { defineConfig } from \'vite\';\nimport react from \'@vitejs/plugin-react\';\nexport default defineConfig({ plugins: [react()] });\n```\n\n' +
      '**Run:** `npm install && npm run dev`\n\nFeatures: sidebar playlist, album art (gradient per track), play/pause/prev/next controls, progress bar scrubbing, volume slider. Extend with real `<audio>` src attributes to play actual files.'
    );
  }

export function generateBuilderFastAPIApp(_desc: string): string {
    return (
      'Building a Python FastAPI REST API.\n\n' +
      '```txt title="requirements.txt"\nfastapi>=0.111.0\nuvicorn[standard]>=0.30.0\npydantic>=2.7.0\n```\n\n' +
      '```python title="main.py"\nfrom fastapi import FastAPI, HTTPException\nfrom fastapi.middleware.cors import CORSMiddleware\nfrom pydantic import BaseModel\nfrom typing import Optional\nimport uuid\n\napp = FastAPI(title="Inventory API", version="1.0.0")\n\napp.add_middleware(\n    CORSMiddleware,\n    allow_origins=["*"],\n    allow_methods=["*"],\n    allow_headers=["*"],\n)\n\n# In-memory store (replace with database)\nitems: dict[str, dict] = {}\n\nclass Item(BaseModel):\n    name: str\n    description: Optional[str] = None\n    price: float\n    in_stock: bool = True\n\nclass ItemUpdate(BaseModel):\n    name: Optional[str] = None\n    description: Optional[str] = None\n    price: Optional[float] = None\n    in_stock: Optional[bool] = None\n\n@app.get("/health")\ndef health():\n    return {"status": "ok", "items": len(items)}\n\n@app.get("/items")\ndef list_items():\n    return {"items": list(items.values()), "total": len(items)}\n\n@app.get("/items/{item_id}")\ndef get_item(item_id: str):\n    item = items.get(item_id)\n    if not item:\n        raise HTTPException(status_code=404, detail="Item not found")\n    return item\n\n@app.post("/items", status_code=201)\ndef create_item(item: Item):\n    item_id = str(uuid.uuid4())\n    record = {"id": item_id, **item.model_dump()}\n    items[item_id] = record\n    return record\n\n@app.put("/items/{item_id}")\n@app.patch("/items/{item_id}")\ndef update_item(item_id: str, update: ItemUpdate):\n    item = items.get(item_id)\n    if not item:\n        raise HTTPException(status_code=404, detail="Item not found")\n    for field, val in update.model_dump(exclude_none=True).items():\n        item[field] = val\n    return item\n\n@app.delete("/items/{item_id}", status_code=204)\ndef delete_item(item_id: str):\n    if item_id not in items:\n        raise HTTPException(status_code=404, detail="Item not found")\n    del items[item_id]\n```\n\n' +
      '**Run:**\n```bash\npip install -r requirements.txt\nuvicorn main:app --reload --port 8000\n```\n\n' +
      'Interactive docs available at `http://localhost:8000/docs` (Swagger UI) and `/redoc`.\n\n' +
      'Endpoints: `GET /health`, `GET /items`, `GET /items/{id}`, `POST /items`, `PUT /items/{id}`, `PATCH /items/{id}`, `DELETE /items/{id}`.'
    );
  }

export function generateBuilderGoServer(_desc: string): string {
    return (
      'Building a Go HTTP API server.\n\n' +
      '```go title="go.mod"\nmodule myapi\n\ngo 1.22\n```\n\n' +
      '```go title="main.go"\npackage main\n\nimport (\n\t"encoding/json"\n\t"fmt"\n\t"log"\n\t"net/http"\n\t"strings"\n\t"sync"\n\t"time"\n)\n\ntype Item struct {\n\tID        string    `json:"id"`\n\tName      string    `json:"name"`\n\tCreatedAt time.Time `json:"createdAt"`\n}\n\nvar (\n\tstore = map[string]Item{}\n\tmu    sync.RWMutex\n\tctr   int\n)\n\nfunc main() {\n\tmux := http.NewServeMux()\n\tmux.HandleFunc("/health", handleHealth)\n\tmux.HandleFunc("/api/items", handleItems)\n\tmux.HandleFunc("/api/items/", handleItem)\n\n\tlog.Println("Server listening on :8080")\n\tif err := http.ListenAndServe(":8080", cors(mux)); err != nil {\n\t\tlog.Fatal(err)\n\t}\n}\n\nfunc handleHealth(w http.ResponseWriter, r *http.Request) {\n\tjson.NewEncoder(w).Encode(map[string]any{"status": "ok", "time": time.Now()})\n}\n\nfunc handleItems(w http.ResponseWriter, r *http.Request) {\n\tw.Header().Set("Content-Type", "application/json")\n\tswitch r.Method {\n\tcase http.MethodGet:\n\t\tmu.RLock()\n\t\tlist := make([]Item, 0, len(store))\n\t\tfor _, v := range store { list = append(list, v) }\n\t\tmu.RUnlock()\n\t\tjson.NewEncoder(w).Encode(list)\n\tcase http.MethodPost:\n\t\tvar body struct{ Name string `json:"name"` }\n\t\tif err := json.NewDecoder(r.Body).Decode(&body); err != nil {\n\t\t\thttp.Error(w, err.Error(), 400); return\n\t\t}\n\t\tmu.Lock()\n\t\tctr++\n\t\titem := Item{ID: fmt.Sprintf("%d", ctr), Name: body.Name, CreatedAt: time.Now()}\n\t\tstore[item.ID] = item\n\t\tmu.Unlock()\n\t\tw.WriteHeader(201)\n\t\tjson.NewEncoder(w).Encode(item)\n\tdefault:\n\t\thttp.Error(w, "method not allowed", 405)\n\t}\n}\n\nfunc handleItem(w http.ResponseWriter, r *http.Request) {\n\tw.Header().Set("Content-Type", "application/json")\n\tid := strings.TrimPrefix(r.URL.Path, "/api/items/")\n\tmu.RLock()\n\titem, ok := store[id]\n\tmu.RUnlock()\n\tif !ok { http.Error(w, `{"error":"not found"}`, 404); return }\n\tif r.Method == http.MethodDelete {\n\t\tmu.Lock(); delete(store, id); mu.Unlock()\n\t\tw.WriteHeader(204); return\n\t}\n\tjson.NewEncoder(w).Encode(item)\n}\n\nfunc cors(next http.Handler) http.Handler {\n\treturn http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {\n\t\tw.Header().Set("Access-Control-Allow-Origin", "*")\n\t\tw.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")\n\t\tw.Header().Set("Access-Control-Allow-Headers", "Content-Type")\n\t\tif r.Method == "OPTIONS" { return }\n\t\tnext.ServeHTTP(w, r)\n\t})\n}\n' +
      '```\n\n' +
      '**Run:**\n```bash\ngo run main.go\n```\n\n' +
      'Endpoints: `GET /health`, `GET /api/items`, `POST /api/items`, `GET /api/items/{id}`, `DELETE /api/items/{id}`.\n\nNo external dependencies — uses Go stdlib only. Add persistence with `database/sql` + SQLite or Postgres when ready.'
    );
  }

export function generateBuilderSvelteApp(_desc: string): string {
    return (
      'Building a SvelteKit app.\n\n' +
      '```json title="package.json"\n' +
      '{\n  "name": "svelte-app",\n  "private": true,\n  "version": "0.0.1",\n  "type": "module",\n  "scripts": {\n    "dev": "vite dev",\n    "build": "vite build",\n    "preview": "vite preview"\n  },\n  "devDependencies": {\n    "@sveltejs/adapter-auto": "^3.0.0",\n    "@sveltejs/kit": "^2.5.0",\n    "@sveltejs/vite-plugin-svelte": "^3.1.0",\n    "svelte": "^4.2.17",\n    "vite": "^5.3.0"\n  }\n}\n' +
      '```\n\n' +
      '```js title="svelte.config.js"\nimport adapter from \'@sveltejs/adapter-auto\';\nexport default { kit: { adapter: adapter() } };\n```\n\n' +
      '```js title="vite.config.js"\nimport { sveltekit } from \'@sveltejs/vite-plugin-svelte\';\nimport { defineConfig } from \'vite\';\nexport default defineConfig({ plugins: [sveltekit()] });\n```\n\n' +
      '```svelte title="src/routes/+page.svelte"\n<script>\n  let count = $state(0);\n  let todos = $state([]);\n  let input = $state(\'\');\n\n  function addTodo() {\n    if (!input.trim()) return;\n    todos.push({ id: Date.now(), text: input, done: false });\n    input = \'\';\n  }\n\n  function toggle(id) {\n    const t = todos.find(t => t.id === id);\n    if (t) t.done = !t.done;\n  }\n</script>\n\n<main>\n  <h1>SvelteKit App</h1>\n  <section>\n    <h2>Counter</h2>\n    <button on:click={() => count--}>-</button>\n    <span>{count}</span>\n    <button on:click={() => count++}>+</button>\n  </section>\n  <section>\n    <h2>Todo List</h2>\n    <div class="row">\n      <input bind:value={input} on:keydown={e => e.key === \'Enter\' && addTodo()} placeholder="Add todo..."/>\n      <button on:click={addTodo}>Add</button>\n    </div>\n    <ul>\n      {#each todos as todo}\n        <li class:done={todo.done} on:click={() => toggle(todo.id)}>{todo.text}</li>\n      {/each}\n    </ul>\n  </section>\n</main>\n\n<style>\n  main { max-width: 500px; margin: 48px auto; font-family: Inter, sans-serif; padding: 0 16px; }\n  h1 { font-size: 28px; font-weight: 800; margin-bottom: 32px; }\n  h2 { font-size: 18px; font-weight: 700; margin-bottom: 12px; }\n  section { margin-bottom: 40px; }\n  button { background: #6366f1; color: #fff; border: none; border-radius: 8px; padding: 8px 16px; cursor: pointer; font-size: 14px; }\n  button:hover { background: #4f46e5; }\n  span { margin: 0 16px; font-size: 24px; font-weight: 700; }\n  .row { display: flex; gap: 8px; margin-bottom: 16px; }\n  input { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 14px; }\n  ul { list-style: none; padding: 0; }\n  li { padding: 12px 16px; border: 1px solid #f1f5f9; border-radius: 8px; cursor: pointer; margin-bottom: 8px; }\n  li.done { text-decoration: line-through; color: #94a3b8; }\n</style>\n' +
      '```\n\n' +
      '**Run:** `npm install && npm run dev`'
    );
  }

export function generateBuilderSocialBlogUpgrade(_desc: string): string {
    return `\`\`\`jsx title="src/App.jsx"
import React, { useState } from 'react';

const seededPosts = [
  { id: 1, title: "Tonight's reset", body: 'Shared a calm nightly reset ritual with the community and it immediately sparked discussion.', author: 'Maya', tag: 'Lifestyle' },
  { id: 2, title: 'Neighborhood coffee notes', body: 'Wrote a quick city guide post after trying three late-night coffee spots in one weekend.', author: 'Jon', tag: 'City' },
  { id: 3, title: 'Small-team writing rituals', body: 'A short post about how tiny editorial teams keep momentum without losing voice.', author: 'Ari', tag: 'Writing' },
];

const activity = [
  'Maya published a new lifestyle post 4m ago',
  "Jon bookmarked Tonight's reset",
  'Ari replied to Neighborhood coffee notes',
  'Writers are leaning into reflective posts tonight',
  'Featured stories are getting saved faster than replies',
];

const trends = ['Evening routines', 'City diaries', 'Writing rituals'];

export default function App() {
  const [posts, setPosts] = useState(seededPosts);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  function publishPost() {
    const nextTitle = title.trim();
    const nextBody = body.trim();
    if (!nextTitle || !nextBody) return;

    setPosts((current) => [
      { id: Date.now(), title: nextTitle, body: nextBody, author: 'You', tag: 'Fresh post' },
      ...current,
    ]);
    setTitle('');
    setBody('');
  }

  return (
    <main className='social-shell'>
      <header className='social-header'>
        <div>
          <p className='eyebrow'>Upgraded social blogging app</p>
          <h1>Social Hub</h1>
          <p className='lede'>An editorial night-feed with a real publishing loop, live community signals, and a feed-first layout.</p>
        </div>
        <div className='ticker'>
          {trends.map((trend) => (
            <span key={trend}>{trend}</span>
          ))}
        </div>
      </header>

      <section className='social-grid'>
        <aside className='composer-rail'>
          <div className='section-head'>
            <span className='label'>Compose</span>
            <h2>Write a Post</h2>
          </div>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder='Post title' />
          <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder='What are you publishing today?' rows={7} />
          <button type='button' onClick={publishPost}>Publish Post</button>
        </aside>

        <section className='feed-stage'>
          <div className='section-head feed-head'>
            <div>
              <span className='label'>Community</span>
              <h2>Blog Feed</h2>
            </div>
            <span className='count'>{posts.length} posts</span>
          </div>
          <div className='feed-list'>
            {posts.map((post) => (
              <article key={post.id} className='story'>
                <div className='story-meta'>
                  <span>{post.author}</span>
                  <span>{post.tag}</span>
                </div>
                <h3>{post.title}</h3>
                <p>{post.body}</p>
              </article>
            ))}
          </div>
        </section>

        <aside className='pulse-rail'>
          <div className='section-head'>
            <span className='label'>Now</span>
            <h2>Community Pulse</h2>
          </div>
          <div className='pulse-list'>
            {activity.map((entry) => (
              <div key={entry} className='pulse-item'>{entry}</div>
            ))}
          </div>
          <article className='featured-card'>
            <span className='featured-label'>Featured Post</span>
            <strong>Tonight's reset</strong>
            <p>Short reflective writing with strong community traction and clear personal voice.</p>
          </article>
        </aside>
      </section>
    </main>
  );
}
\`\`\``;
  }

export function generateBuilderReferenceSocialApp(_desc: string): string {
    return `\`\`\`json title="package.json"
{
  "name": "pulsewire-feed",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.10"
  }
}
\`\`\`

\`\`\`html title="index.html"
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pulsewire</title>
    <script type="module" src="/src/main.jsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
\`\`\`

\`\`\`jsx title="src/main.jsx"
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
\`\`\`

\`\`\`jsx title="src/App.jsx"
import React, { useState } from "react";

const seedPosts = [
  {
    id: 1,
    avatar: "MC",
    author: "Mira Chen",
    handle: "@mirachen",
    time: "2m",
    text: "Tightened the hero spacing and the page reads cleaner instantly. Small rhythm changes matter more than most redesigns.",
    stats: { replies: 142, reposts: 38, likes: "1.2K" },
    tag: "Design Ops",
  },
  {
    id: 2,
    avatar: "AV",
    author: "Ari Vale",
    handle: "@arivale",
    time: "14m",
    text: "Reference-inspired work is strongest when you copy hierarchy and interaction density, not trademarks or brand copy.",
    stats: { replies: 48, reposts: 19, likes: "740" },
    tag: "Interface Systems",
  },
  {
    id: 3,
    avatar: "JP",
    author: "Jon Park",
    handle: "@jonpark",
    time: "32m",
    text: "Prototype the timeline first, then add profile rails and trends once the main conversation loop feels alive.",
    stats: { replies: 25, reposts: 12, likes: "403" },
    tag: "Builder Workflow",
  },
];

const people = [
  { name: "Nia Stone", handle: "@niastone", note: "Product systems", avatar: "NS" },
  { name: "Leo Hart", handle: "@leohart", note: "Interface motion", avatar: "LH" },
  { name: "Sami Noor", handle: "@saminoor", note: "Frontend craft", avatar: "SN" },
];

const trends = [
  { label: "Design systems for fast teams", meta: "2.4K posts" },
  { label: "Reference-driven product builds", meta: "1.2K posts" },
  { label: "Timeline composer UX", meta: "860 posts" },
];

const signalCards = [
  { label: "Posts today", value: "184", note: "steady cadence" },
  { label: "Reply rate", value: "91%", note: "high signal" },
  { label: "Saved ideas", value: "26", note: "worth iterating" },
];

const composerPrompts = [
  "Turn the hero notes into a thread",
  "Ship the tighter tablet pass",
  "Keep the feed density high",
];

const buildCues = [
  "Use hierarchy and spacing, not logos, as the reference signal.",
  "Treat the composer as the center of gravity for the first preview.",
  "Side rails should clarify the feed, not just decorate it.",
];

export default function App() {
  const [posts, setPosts] = useState(seedPosts);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState("For You");

  function publishPost() {
    const nextDraft = draft.trim();
    if (!nextDraft) return;

    setPosts((current) => [
      {
        id: Date.now(),
        avatar: "YO",
        author: "You",
        handle: "@you",
        time: "now",
        text: nextDraft,
        stats: { replies: 0, reposts: 0, likes: "0" },
        tag: "Fresh post",
      },
      ...current,
    ]);
    setDraft("");
  }

  return (
    <main className="shell">
      <aside className="rail card">
        <div className="brand-block">
          <div>
            <p className="eyebrow">Reference-inspired social app</p>
            <h1>Pulsewire</h1>
          </div>
          <span className="live-pill">Live build</span>
        </div>

        <p className="rail-copy">
          Built to capture feed rhythm, density, and posting flow without cloning brand assets one to one.
        </p>

        <div className="nav-list">
          {["For You", "Following"].map((label) => (
            <button
              key={label}
              className={label === tab ? "nav-pill active" : "nav-pill"}
              onClick={() => setTab(label)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="signal-grid">
          {signalCards.map((entry) => (
            <div key={entry.label} className="signal-card">
              <strong>{entry.value}</strong>
              <span>{entry.label}</span>
              <small>{entry.note}</small>
            </div>
          ))}
        </div>

        <div className="rail-note-block">
          <span className="note-kicker">Why it reads fast</span>
          <ul>
            <li>Primary tab state is obvious immediately.</li>
            <li>Composer sits above the timeline, not beside it.</li>
            <li>Useful side rails balance the center column.</li>
          </ul>
        </div>

        <button className="secondary-cta" type="button">Review layout rhythm</button>
      </aside>

      <section className="feed-column">
        <header className="hero card">
          <div className="hero-topline">
            <p className="eyebrow">Public conversation feed</p>
            <span className="hero-badge">Reference-ready</span>
          </div>
          <div className="hero-row">
            <div>
              <h2>{tab}</h2>
              <p className="lede">A denser feed with a real composer, seeded momentum, and side rails that feel useful instead of decorative.</p>
            </div>
            <div className="hero-metrics">
              <div>
                <strong>{posts.length}</strong>
                <span>Posts live</span>
              </div>
              <div>
                <strong>3</strong>
                <span>Signals tracked</span>
              </div>
              <div>
                <strong>11m</strong>
                <span>Avg response loop</span>
              </div>
            </div>
          </div>
          <div className="feed-filters">
            <span className="filter-chip active">Latest</span>
            <span className="filter-chip">Popular</span>
            <span className="filter-chip">Saved</span>
          </div>

          <div className="hero-strip">
            <div>
              <span className="strip-label">Density goal</span>
              <strong>Fast scan, low clutter, obvious motion.</strong>
            </div>
            <div>
              <span className="strip-label">Preview priority</span>
              <strong>Composer first, conversation loop second.</strong>
            </div>
          </div>
        </header>

        <section className="composer card">
          <div className="composer-shell">
            <div className="avatar avatar-large">YO</div>
            <div className="composer-body">
              <div className="composer-head">
                <strong>Compose</strong>
                <span>Post update</span>
              </div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Share an update about the build..."
                rows={3}
              />
              <div className="composer-tools">
                {composerPrompts.map((prompt) => (
                  <span key={prompt} className="tool-chip">{prompt}</span>
                ))}
              </div>
              <div className="composer-actions">
                <span className="hint">Keep the first slice focused on the main timeline loop.</span>
                <button onClick={publishPost}>Post update</button>
              </div>
            </div>
          </div>
        </section>

        <section className="timeline">
          {posts.map((post) => (
            <article key={post.id} className="post card">
              <div className="post-head">
                <div className="post-head-main">
                  <div className="avatar">{post.avatar}</div>
                  <div>
                    <div className="post-identity">
                      <strong>{post.author}</strong>
                      <span className="tag-pill">{post.tag}</span>
                    </div>
                    <span>{post.handle}</span>
                  </div>
                </div>
                <span>{post.time}</span>
              </div>
              <p className="post-copy">{post.text}</p>
              <footer className="post-actions">
                <span>{post.stats.replies} replies</span>
                <span>{post.stats.reposts} reposts</span>
                <span>{post.stats.likes} likes</span>
              </footer>
            </article>
          ))}
        </section>
      </section>

      <aside className="sidebar">
        <section className="card side-panel">
          <h3>Who to follow</h3>
          <div className="people-list">
            {people.map((person) => (
              <article key={person.handle} className="person-row">
                <div className="person-main">
                  <div className="avatar avatar-small">{person.avatar}</div>
                  <div>
                    <strong>{person.name}</strong>
                    <span>{person.handle}</span>
                  </div>
                </div>
                <small>{person.note}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="card side-panel">
          <h3>Trends</h3>
          <div className="trend-list">
            {trends.map((trend) => (
              <div key={trend.label} className="trend-item">
                <strong>{trend.label}</strong>
                <span>{trend.meta}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card side-panel cue-panel">
          <h3>Build cues</h3>
          <div className="cue-list">
            {buildCues.map((cue) => (
              <p key={cue}>{cue}</p>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}
\`\`\`

\`\`\`css title="src/styles.css"
@import url("https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap");

:root {
  color-scheme: dark;
  color: #ecf3ff;
  background: #07111f;
  font-family: "Manrope", "Segoe UI", system-ui, sans-serif;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at top, rgba(34, 197, 94, 0.14), transparent 24%),
    radial-gradient(circle at right top, rgba(56, 189, 248, 0.14), transparent 20%),
    linear-gradient(rgba(125, 211, 252, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(125, 211, 252, 0.045) 1px, transparent 1px),
    linear-gradient(180deg, #07111f 0%, #030712 100%);
  background-size: auto, auto, 100% 36px, 36px 100%, auto;
}
button, textarea { font: inherit; }
button { cursor: pointer; }
textarea {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.78);
  color: #ecf3ff;
  padding: 14px 16px;
  resize: none;
  min-height: 104px;
}
.shell {
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px 18px 56px;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr) 304px;
  gap: 16px;
  align-items: start;
}
.card {
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 24px;
  background: rgba(6, 14, 27, 0.82);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.26);
  backdrop-filter: blur(18px);
}
.rail, .hero, .composer, .post, .side-panel { padding: 18px; }
.eyebrow {
  margin: 0 0 10px;
  color: #7dd3fc;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.75rem;
}
.rail h1, .hero h2, .side-panel h3 { margin: 0; }
.nav-list, .timeline, .people-list, .trend-list, .sidebar { display: grid; gap: 12px; }
.rail {
  position: sticky;
  top: 20px;
  display: grid;
  gap: 16px;
}
.brand-block,
.hero-topline,
.hero-row,
.person-main,
.post-head-main,
.composer-shell {
  display: flex;
  gap: 12px;
}
.brand-block,
.hero-topline,
.post-head,
.composer-head,
.composer-actions,
.person-row,
.trend-item {
  justify-content: space-between;
  align-items: center;
}
.brand-block { align-items: flex-start; }
.rail-copy {
  margin: 0;
  color: #b6c7dd;
  line-height: 1.65;
}
.live-pill,
.hero-badge,
.tag-pill,
.filter-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.18);
  background: rgba(56, 189, 248, 0.08);
  color: #a5f3fc;
  font-size: 0.76rem;
  padding: 7px 11px;
}
.nav-pill {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(15, 23, 42, 0.72);
  color: #d7e7fb;
  padding: 12px 14px;
  border-radius: 999px;
  text-align: left;
}
.nav-pill.active {
  background: linear-gradient(135deg, #38bdf8, #22c55e);
  color: #04111d;
  border-color: transparent;
}
.lede, .hint, .person-row small, .post-actions, .post-head span, .trend-item span, .signal-card span, .signal-card small {
  color: #9fb2c9;
}
.secondary-cta {
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.65);
  color: #e2e8f0;
  padding: 12px 14px;
  border-radius: 16px;
}
.signal-grid,
.hero-metrics,
.feed-filters,
.post-actions {
  display: grid;
  gap: 10px;
}
.signal-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.signal-card {
  display: grid;
  gap: 3px;
  padding: 12px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.1);
}
.signal-card strong,
.hero-metrics strong {
  font-size: 1rem;
}
.signal-card small {
  font-size: 0.74rem;
}
.rail-note-block {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.08);
}
.rail-note-block ul {
  margin: 0;
  padding-left: 1rem;
  display: grid;
  gap: 8px;
  color: #c9d8ea;
}
.note-kicker,
.strip-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: #67e8f9;
}
.feed-column { display: grid; gap: 16px; }
.hero {
  display: grid;
  gap: 14px;
}
.hero-row {
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
}
.hero-metrics {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  min-width: 320px;
}
.hero-metrics div {
  padding: 12px 13px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(148, 163, 184, 0.1);
}
.feed-filters {
  grid-auto-flow: column;
  justify-content: flex-start;
}
.filter-chip.active {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(34, 197, 94, 0.22));
  color: #e6fbff;
}
.hero-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.hero-strip div {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.08);
}
.hero-strip strong {
  color: #dceaf8;
  font-size: 0.96rem;
  line-height: 1.45;
}
.composer {
  display: grid;
  gap: 12px;
}
.composer-shell {
  align-items: flex-start;
}
.composer-body {
  flex: 1;
  display: grid;
  gap: 12px;
}
.composer-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tool-chip {
  padding: 8px 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(255, 255, 255, 0.03);
  color: #bfd0e4;
  font-size: 0.82rem;
}
.composer-actions button {
  border: 0;
  border-radius: 999px;
  padding: 12px 18px;
  background: linear-gradient(135deg, #38bdf8, #22c55e);
  color: #04111d;
  font-weight: 700;
}
.avatar {
  width: 44px;
  height: 44px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  font-size: 0.82rem;
  font-weight: 800;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(34, 197, 94, 0.2));
  color: #dff9ff;
  border: 1px solid rgba(125, 211, 252, 0.16);
}
.avatar-large { width: 48px; height: 48px; }
.avatar-small {
  width: 38px;
  height: 38px;
  border-radius: 14px;
  font-size: 0.74rem;
}
.post {
  display: grid;
  gap: 12px;
}
.post-copy {
  margin: 0;
  line-height: 1.68;
  color: #edf4ff;
}
.post-head,
.person-row {
  display: flex;
  gap: 12px;
}
.post-head strong, .person-row strong { display: block; }
.post-identity {
  display: flex;
  gap: 10px;
  align-items: center;
}
.post-head div span, .person-row span { font-size: 0.9rem; }
.person-row, .trend-item {
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(255, 255, 255, 0.03);
  padding: 14px;
}
.person-row {
  align-items: flex-start;
}
.trend-item {
  display: grid;
  gap: 6px;
  align-items: flex-start;
}
.post-actions {
  grid-auto-flow: column;
  justify-content: flex-start;
  font-size: 0.92rem;
  padding-top: 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.08);
}
.sidebar {
  position: sticky;
  top: 20px;
}
.cue-list {
  display: grid;
  gap: 10px;
}
.cue-list p {
  margin: 0;
  padding: 12px 0 0;
  border-top: 1px solid rgba(148, 163, 184, 0.08);
  color: #d7e3f2;
  line-height: 1.55;
}
.cue-list p:first-child {
  padding-top: 0;
  border-top: 0;
}
@media (max-width: 1180px) {
  .shell { grid-template-columns: 220px minmax(0, 1fr); }
  .sidebar { grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hero-row { flex-direction: column; align-items: flex-start; }
  .hero-metrics,
  .hero-strip { width: 100%; }
}
@media (max-width: 820px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar { grid-template-columns: 1fr; }
  .rail, .sidebar { position: static; }
  .signal-grid,
  .hero-metrics,
  .post-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hero-strip { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .shell { padding: 18px 12px 36px; }
  .card { border-radius: 22px; }
  .composer-shell,
  .composer-actions,
  .post-head,
  .person-row,
  .hero-topline,
  .brand-block { flex-direction: column; align-items: flex-start; }
  .signal-grid,
  .hero-metrics,
  .post-actions { grid-template-columns: 1fr; }
  .feed-filters { grid-auto-flow: row; }
}
\`\`\``;
  }

export function generateBuilderReferenceLandingPage(_desc: string): string {
    return `\`\`\`json title="package.json"
{
  "name": "northstar-marketing",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.10"
  }
}
\`\`\`

\`\`\`html title="index.html"
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Northstar Studio</title>
    <script type="module" src="/src/main.jsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
\`\`\`

\`\`\`jsx title="src/main.jsx"
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
\`\`\`

\`\`\`jsx title="src/App.jsx"
import React from "react";

const highlights = [
  "Reference-led layout planning",
  "Clean CTA hierarchy",
  "Preview-ready proof sections",
];

const metrics = [
  { value: "18d", label: "Average launch cycle" },
  { value: "94%", label: "Preview approval rate" },
  { value: "3x", label: "Faster stakeholder signoff" },
];

const proofPillars = [
  {
    title: "Editorial first fold",
    text: "The page opens with one thesis, one proof frame, and one clear CTA pair instead of six competing ideas.",
  },
  {
    title: "Reference without imitation",
    text: "Hierarchy, pacing, and visual density echo the source while the language, claims, and framing stay original.",
  },
  {
    title: "Preview-friendly structure",
    text: "Sections hold together in a runnable build, so refinements can happen in the browser instead of in static mockups.",
  },
];

const cards = [
  {
    title: "Hero with a thesis",
    text: "The page makes one clear promise fast, then backs it up with a visible proof system instead of filler.",
  },
  {
    title: "Sections with pressure tolerance",
    text: "Spacing, contrast, and hierarchy still hold together when the layout is squeezed to tablet or phone widths.",
  },
  {
    title: "Original build language",
    text: "The visual direction can echo a strong public reference while keeping the copy, framing, and assets distinct.",
  },
];

const reviewNotes = [
  "Headline and CTA read in one sweep.",
  "Proof cards add substance instead of noise.",
  "The first screen feels like a product, not a starter template.",
];

export default function App() {
  return (
    <main className="page-shell">
      <section className="hero-panel">
        <nav className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark">NS</span>
            <strong>Northstar Studio</strong>
          </div>
          <div className="nav-links">
            <a href="#proof">Proof</a>
            <a href="#workflow">Workflow</a>
            <a href="#results">Results</a>
            <span className="status-pill">Preview-ready</span>
          </div>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Reference-inspired marketing page</p>
            <h1>Proof, not placeholders.</h1>
            <p className="lede">
              A polished landing page shell built to capture the density, confidence, and pacing of a strong public reference without copying brand assets directly.
            </p>
            <div className="impact-row">
              {metrics.map((metric) => (
                <div key={metric.label} className="impact-chip">
                  <strong>{metric.value}</strong>
                  <span>{metric.label}</span>
                </div>
              ))}
            </div>
            <div className="cta-row">
              <button>Book a walkthrough</button>
              <a href="#proof">See the product</a>
            </div>
            <div className="highlight-row">
              {highlights.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div className="pillar-grid">
              {proofPillars.map((pillar) => (
                <article key={pillar.title} className="pillar-card">
                  <strong>{pillar.title}</strong>
                  <p>{pillar.text}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="hero-card">
            <div className="hero-card-topline">
              <span className="card-label">Launch board</span>
              <span className="status-pill inverse">Review flow</span>
            </div>
            <strong>Screenshot-ready review</strong>
            <p>Headline, visual anchor, proof rail, and CTA cluster all tuned for faster stakeholder reads.</p>
            <div className="specimen-stack">
              <div className="specimen-card">
                <span>Hero thesis</span>
                <strong>One promise above the fold</strong>
                <p>Clear claim, controlled line length, and immediate CTA hierarchy.</p>
              </div>
              <div className="specimen-card muted">
                <span>Proof lane</span>
                <strong>Visible structure, not decorative filler</strong>
                <p>Cards and notes reinforce the headline instead of competing with it.</p>
              </div>
            </div>
            <div className="review-stack">
              {reviewNotes.map((note, index) => (
                <div key={note} className="review-note">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{note}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section id="proof" className="content-section">
        <div className="section-head">
          <p className="eyebrow">Why it lands</p>
          <h2>Structure that survives close inspection</h2>
        </div>
        <div className="card-grid">
          {cards.map((card) => (
            <article key={card.title} className="proof-card">
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="content-section split-section">
        <article className="feature-panel">
          <p className="eyebrow">Workflow</p>
          <h2>From reference to working preview</h2>
          <p>Freeze the hierarchy, rebuild it with original copy, then iterate in a runnable sandbox until the spacing and interaction carry their weight.</p>
          <ol className="workflow-list">
            <li>Lock the visual hierarchy that matters.</li>
            <li>Rewrite the copy so the build is yours.</li>
            <li>Tune spacing, proof blocks, and CTA flow in preview.</li>
          </ol>
        </article>
        <article id="results" className="feature-panel emphasis">
          <p className="eyebrow">Outcome</p>
          <h2>Design language you can keep extending</h2>
          <p>A strong first slice already supports cleaner typography, proof sections, and credible CTA flows without collapsing into a generic starter.</p>
        </article>
      </section>
    </main>
  );
}
\`\`\`

\`\`\`css title="src/styles.css"
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,800&family=Manrope:wght@400;500;600;700;800&display=swap");

:root {
  color: #122033;
  background: #f5ecde;
  font-family: "Manrope", "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(234, 88, 12, 0.16), transparent 20%),
    radial-gradient(circle at 85% 12%, rgba(15, 23, 42, 0.06), transparent 18%),
    linear-gradient(180deg, #f7f1e7 0%, #efe3d1 100%);
}

a { color: inherit; text-decoration: none; }
button { font: inherit; cursor: pointer; }

.page-shell {
  max-width: 1280px;
  margin: 0 auto;
  padding: 22px 18px 72px;
}

.hero-panel {
  padding: 26px;
  border-radius: 30px;
  border: 1px solid rgba(18, 32, 51, 0.08);
  background: rgba(255, 251, 245, 0.86);
  box-shadow: 0 24px 72px rgba(95, 60, 17, 0.12);
  overflow: hidden;
}

.topbar,
.hero-grid,
.nav-links,
.cta-row,
.brand-lockup,
.split-section {
  display: flex;
  gap: 16px;
}

.topbar {
  justify-content: space-between;
  align-items: center;
}

.brand-lockup { align-items: center; }

.brand-mark {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  background: #122033;
  color: #fff7ec;
  font-weight: 800;
}

.nav-links a {
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(18, 32, 51, 0.05);
  color: #334155;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 10px 14px;
  border-radius: 999px;
  border: 1px solid rgba(18, 32, 51, 0.12);
  background: rgba(18, 32, 51, 0.05);
  color: #122033;
  font-size: 0.84rem;
}

.status-pill.inverse {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: #eff6ff;
}

.hero-grid {
  margin-top: 30px;
  align-items: stretch;
}

.hero-copy {
  flex: 1.08;
  display: grid;
  gap: 18px;
  padding: 6px 4px 6px 0;
}

.hero-copy h1,
.section-head h2,
.feature-panel h2,
.proof-card h3 {
  font-family: "Fraunces", "Georgia", serif;
}

.hero-copy h1 {
  margin: 0;
  max-width: 7.5ch;
  font-size: clamp(2.9rem, 5.8vw, 4.8rem);
  line-height: 0.9;
  letter-spacing: -0.045em;
}

.eyebrow {
  margin: 0;
  font-size: 0.76rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #a05712;
}

.lede {
  margin: 0;
  max-width: 34rem;
  color: #475569;
  font-size: 1.05rem;
  line-height: 1.72;
}

.impact-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.impact-chip {
  display: grid;
  gap: 4px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(18, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.4);
}

.impact-chip strong {
  font-size: 1.2rem;
}

.impact-chip span {
  color: #475569;
  font-size: 0.88rem;
}

.cta-row {
  flex-wrap: wrap;
  align-items: center;
}

.cta-row button {
  border: 0;
  border-radius: 999px;
  padding: 14px 22px;
  background: #122033;
  color: #fff7ec;
  box-shadow: 0 18px 36px rgba(18, 32, 51, 0.15);
}

.cta-row a {
  padding-bottom: 2px;
  border-bottom: 1px solid rgba(18, 32, 51, 0.18);
}

.highlight-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.highlight-row span {
  padding: 10px 14px;
  border-radius: 999px;
  border: 1px solid rgba(18, 32, 51, 0.08);
  background: rgba(18, 32, 51, 0.04);
  color: #334155;
  font-size: 0.92rem;
}

.pillar-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.pillar-card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid rgba(18, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.45);
}

.pillar-card strong {
  font-size: 0.98rem;
}

.pillar-card p {
  margin: 0;
  color: #475569;
  line-height: 1.58;
}

.hero-card,
.proof-card,
.feature-panel {
  border-radius: 24px;
}

.hero-card {
  flex: 0.92;
  display: grid;
  gap: 16px;
  padding: 24px;
  background: linear-gradient(180deg, #172437 0%, #0f172a 100%);
  color: #eff6ff;
}

.hero-card-topline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.card-label {
  display: inline-block;
  font-size: 0.74rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #fdba74;
}

.specimen-stack {
  display: grid;
  gap: 12px;
}

.specimen-card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.specimen-card span {
  color: #fdba74;
  font-size: 0.74rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.specimen-card strong {
  font-size: 1.12rem;
}

.specimen-card.muted {
  background: rgba(255, 255, 255, 0.04);
}

.specimen-card p,
.review-note p,
.hero-card p { color: #d5deea; }

.review-stack {
  display: grid;
  gap: 12px;
}

.review-note {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.review-note span {
  color: #fdba74;
  font-size: 0.74rem;
  letter-spacing: 0.14em;
}

.content-section {
  padding: 42px 4px 0;
}

.section-head {
  display: grid;
  gap: 12px;
  max-width: 52rem;
}

.section-head h2,
.feature-panel h2 {
  margin: 0;
  font-size: clamp(2rem, 3.8vw, 3.35rem);
  line-height: 0.98;
  letter-spacing: -0.04em;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 20px;
}

.proof-card,
.feature-panel {
  padding: 22px;
  border: 1px solid rgba(18, 32, 51, 0.08);
  background: rgba(255, 251, 245, 0.74);
  box-shadow: 0 16px 34px rgba(95, 60, 17, 0.07);
}

.proof-card h3 {
  margin: 0 0 14px;
  font-size: 1.08rem;
}

.proof-card p,
.feature-panel p,
.workflow-list {
  color: #475569;
  line-height: 1.68;
}

.feature-panel {
  flex: 1;
  display: grid;
  gap: 18px;
}

.workflow-list {
  margin: 0;
  padding-left: 1.15rem;
  display: grid;
  gap: 10px;
}

.feature-panel.emphasis {
  background: linear-gradient(180deg, #122033 0%, #1d2f45 100%);
  color: #eff6ff;
}

.feature-panel.emphasis p,
.feature-panel.emphasis .eyebrow,
.feature-panel.emphasis .workflow-list {
  color: #dbeafe;
}

@media (max-width: 980px) {
  .hero-grid,
  .split-section {
    flex-direction: column;
  }

  .pillar-grid,
  .card-grid,
  .impact-row {
    grid-template-columns: 1fr;
  }

  .hero-copy h1 {
    max-width: 10ch;
  }
}

@media (max-width: 640px) {
  .page-shell {
    padding: 16px 12px 40px;
  }

  .hero-panel,
  .hero-card,
  .proof-card,
  .feature-panel {
    border-radius: 22px;
  }

  .topbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .nav-links {
    flex-wrap: wrap;
  }
}
\`\`\``;
  }

export function generateBuilderNodeTypeScriptServer(desc: string): string {
    return "```json title=\"package.json\"\n" +
      JSON.stringify({
        name: 'node-ts-server-scratch',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'tsx src/server.ts',
          start: 'tsx src/server.ts'
        },
        dependencies: {
          tsx: '^4.19.2'
        },
        devDependencies: {
          typescript: '^5.7.3',
          '@types/node': '^22.10.1'
        }
      }, null, 2) +
      "\n```\n\n" +
      "```json title=\"tsconfig.json\"\n" +
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: 'dist'
        },
        include: ['src/**/*.ts']
      }, null, 2) +
      "\n```\n\n" +
      "```ts title=\"src/server.ts\"\n" +
      "import http from 'node:http';\n\n" +
      "const portArgIndex = process.argv.indexOf('--port');\n" +
      "const hostArgIndex = process.argv.indexOf('--host');\n" +
      "const port = Number(process.argv[portArgIndex + 1] || process.env.PORT || 3000);\n" +
      "const host = process.argv[hostArgIndex + 1] || process.env.HOST || '0.0.0.0';\n\n" +
      "type ApiHealth = { status: 'ok'; runtime: 'node-ts'; prompt: string };\n\n" +
      `const prompt = ${JSON.stringify(desc)};\n\n` +
      "const server = http.createServer((req, res) => {\n" +
      "  if (req.url === '/api/health') {\n" +
      "    const body: ApiHealth = { status: 'ok', runtime: 'node-ts', prompt };\n" +
      "    res.writeHead(200, { 'Content-Type': 'application/json' });\n" +
      "    res.end(JSON.stringify(body));\n" +
      "    return;\n" +
      "  }\n\n" +
      "  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });\n" +
      "  res.end(`<!doctype html><html><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" /><title>Node TypeScript Scratch Server</title><style>body{font-family:Inter,system-ui;margin:0;padding:40px;background:#05131f;color:#e2e8f0}main{max-width:720px;margin:0 auto;padding:28px;border-radius:24px;background:rgba(15,23,42,.84);border:1px solid rgba(255,255,255,.08)}h1{margin-top:0}.pill{display:inline-flex;padding:4px 10px;border-radius:999px;background:rgba(56,189,248,.14);color:#7dd3fc}</style></head><body><main><span class=\"pill\">Node TypeScript</span><h1>Node TypeScript Scratch Server</h1><p>${prompt}</p><p>Open <strong>/api/health</strong> for JSON health.</p></main></body></html>`);\n" +
      "});\n\n" +
        "server.listen(port, host, () => {\n" +
        "  console.log(`Node TS server running on http://${host}:${port}`);\n" +
      "});\n" +
      "```";
  }

export function generateBuilderNodeServer(desc: string): string {
    return "```json title=\"package.json\"\n" +
      JSON.stringify({
        name: 'node-server-scratch',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'node server.js',
          start: 'node server.js'
        }
      }, null, 2) +
      "\n```\n\n" +
      "```js title=\"server.js\"\n" +
      "import http from 'node:http';\n\n" +
      "const port = Number(process.env.PORT || 3000);\n" +
      "const host = process.env.HOST || '0.0.0.0';\n\n" +
      `const prompt = ${JSON.stringify(desc)};\n\n` +
      "const server = http.createServer((req, res) => {\n" +
      "  if (req.url === '/api/health') {\n" +
      "    res.writeHead(200, { 'Content-Type': 'application/json' });\n" +
      "    res.end(JSON.stringify({ status: 'ok', runtime: 'node', prompt }));\n" +
      "    return;\n" +
      "  }\n\n" +
      "  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });\n" +
      "  res.end(`<!doctype html><html><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" /><title>Node Scratch Server</title><style>body{font-family:Inter,system-ui;margin:0;padding:40px;background:#05131f;color:#e2e8f0}main{max-width:720px;margin:0 auto;padding:28px;border-radius:24px;background:rgba(15,23,42,.84);border:1px solid rgba(255,255,255,.08)}h1{margin-top:0}.pill{display:inline-flex;padding:4px 10px;border-radius:999px;background:rgba(56,189,248,.14);color:#7dd3fc}</style></head><body><main><span class=\"pill\">Node.js</span><h1>Node Scratch Server</h1><p>${prompt}</p><p>Open <strong>/api/health</strong> for JSON health.</p></main></body></html>`);\n" +
      "});\n\n" +
      "server.listen(port, host, () => {\n" +
      "  console.log(`Node server running on http://${host}:${port}`);\n" +
      "});\n" +
      "```";
  }

export function generateBuilderNextjsTodoApp(_desc: string): string {
    const pkg = JSON.stringify({
      name: 'todo-app',
      private: true,
      version: '0.1.0',
      scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
      dependencies: { next: '^14.2.0', react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: {
        '@types/node': '^20',
        '@types/react': '^18',
        '@types/react-dom': '^18',
        autoprefixer: '^10.4.19',
        postcss: '^8.4.38',
        tailwindcss: '^3.4.4',
        typescript: '^5',
      },
    }, null, 2);

    return (
      'Building a Next.js 14 todo app with add, complete, and delete — Tailwind CSS styling.\n\n' +
      '```json title="package.json"\n' + pkg + '\n```\n\n' +
      '```tsx title="src/app/layout.tsx"\n' +
      "import type { Metadata } from 'next';\n" +
      "import './globals.css';\n\n" +
      "export const metadata: Metadata = { title: 'Todo App' };\n\n" +
      "export default function RootLayout({ children }: { children: React.ReactNode }) {\n" +
      "  return (\n" +
      "    <html lang=\"en\">\n" +
      "      <body className=\"min-h-screen bg-gray-50\">{children}</body>\n" +
      "    </html>\n" +
      "  );\n" +
      "}\n" +
      '```\n\n' +
      '```css title="src/app/globals.css"\n' +
      '@tailwind base;\n' +
      '@tailwind components;\n' +
      '@tailwind utilities;\n' +
      '```\n\n' +
      '```tsx title="src/app/page.tsx"\n' +
      "'use client';\n" +
      "import { useState } from 'react';\n\n" +
      "interface Todo {\n" +
      "  id: number;\n" +
      "  text: string;\n" +
      "  done: boolean;\n" +
      "}\n\n" +
      "export default function TodoPage() {\n" +
      "  const [todos, setTodos] = useState<Todo[]>([]);\n" +
      "  const [input, setInput] = useState('');\n\n" +
      "  const add = () => {\n" +
      "    const text = input.trim();\n" +
      "    if (!text) return;\n" +
      "    setTodos(prev => [...prev, { id: Date.now(), text, done: false }]);\n" +
      "    setInput('');\n" +
      "  };\n\n" +
      "  const toggle = (id: number) => setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));\n" +
      "  const remove = (id: number) => setTodos(prev => prev.filter(t => t.id !== id));\n\n" +
      "  return (\n" +
      "    <main className=\"max-w-md mx-auto pt-16 px-4\">\n" +
      "      <h1 className=\"text-3xl font-bold text-gray-900 mb-8\">Todo List</h1>\n" +
      "      <div className=\"flex gap-2 mb-6\">\n" +
      "        <input\n" +
      "          className=\"flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500\"\n" +
      "          placeholder=\"Add a todo...\"\n" +
      "          value={input}\n" +
      "          onChange={e => setInput(e.target.value)}\n" +
      "          onKeyDown={e => e.key === 'Enter' && add()}\n" +
      "        />\n" +
      "        <button\n" +
      "          onClick={add}\n" +
      "          className=\"px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700\"\n" +
      "        >Add</button>\n" +
      "      </div>\n" +
      "      <ul className=\"space-y-2\">\n" +
      "        {todos.map(todo => (\n" +
      "          <li key={todo.id} className=\"flex items-center gap-3 bg-white rounded-lg px-4 py-3 shadow-sm\">\n" +
      "            <input\n" +
      "              type=\"checkbox\"\n" +
      "              checked={todo.done}\n" +
      "              onChange={() => toggle(todo.id)}\n" +
      "              className=\"w-4 h-4 accent-blue-600\"\n" +
      "            />\n" +
      "            <span className={`flex-1 text-sm ${todo.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>{todo.text}</span>\n" +
      "            <button onClick={() => remove(todo.id)} className=\"text-gray-400 hover:text-red-500 text-lg leading-none\">×</button>\n" +
      "          </li>\n" +
      "        ))}\n" +
      "      </ul>\n" +
      "      {todos.length === 0 && <p className=\"text-center text-gray-400 text-sm mt-8\">No todos yet. Add one above!</p>}\n" +
      "    </main>\n" +
      "  );\n" +
      "}\n" +
      '```\n\n' +
      '```ts title="tailwind.config.ts"\n' +
      "import type { Config } from 'tailwindcss';\n" +
      "const config: Config = {\n" +
      "  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],\n" +
      "  theme: { extend: {} },\n" +
      "  plugins: [],\n" +
      "};\n" +
      "export default config;\n" +
      '```\n\n' +
      '```js title="postcss.config.js"\n' +
      "module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n" +
      '```'
    );
  }

export function generateBuilderNextjsDefaultStarter(intro?: string): string {
    return intro
      ? intro
      : 'Creating a clean Next.js App Router starter in sandbox now. {{template:nextjs:Fresh Next.js App Router}}';
  }

export function generateBuilderNextjsUpgrade(_desc: string): string {
    return "Updated the current Next.js app in place into Northstar Planner with a shared header, Overview/Roadmap/Notes/About navigation, and new app-router pages for the requested routes. Verify the updated app shows \"Plan calmer. Ship sooner.\" on the home page, \"Quarterly roadmap\" on /roadmap, \"Shared notes\" on /notes, and \"Why Northstar Planner\" on /about.\n\n" +
      "```tsx title=\"src/app/layout.tsx\"\n" +
      "import type { Metadata } from 'next';\n" +
      "import Link from 'next/link';\n" +
      "import './globals.css';\n\n" +
      "export const metadata: Metadata = {\n" +
      "  title: 'Northstar Planner',\n" +
      "  description: 'A calm planning workspace for small teams.',\n" +
      "};\n\n" +
      "const navItems = [\n" +
      "  { href: '/', label: 'Overview' },\n" +
      "  { href: '/roadmap', label: 'Roadmap' },\n" +
      "  { href: '/notes', label: 'Notes' },\n" +
      "  { href: '/about', label: 'About' },\n" +
      "];\n\n" +
      "export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {\n" +
      "  return (\n" +
      "    <html lang=\"en\">\n" +
      "      <body>\n" +
      "        <div className=\"site-shell\">\n" +
      "          <header className=\"site-header\">\n" +
      "            <Link href=\"/\" className=\"brand\">\n" +
      "              <span className=\"brand-mark\">N</span>\n" +
      "              <span>Northstar Planner</span>\n" +
      "            </Link>\n" +
      "            <nav className=\"site-nav\" aria-label=\"Primary\">\n" +
      "              {navItems.map((item) => (\n" +
      "                <Link key={item.href} href={item.href}>\n" +
      "                  {item.label}\n" +
      "                </Link>\n" +
      "              ))}\n" +
      "            </nav>\n" +
      "          </header>\n" +
      "          {children}\n" +
      "        </div>\n" +
      "      </body>\n" +
      "    </html>\n" +
      "  );\n" +
      "}\n" +
      "```\n\n" +
      "```css title=\"src/app/globals.css\"\n" +
      ":root {\n" +
      "  color-scheme: light;\n" +
      "  --bg: #f4efe4;\n" +
      "  --paper: rgba(255, 252, 247, 0.9);\n" +
      "  --ink: #1f2430;\n" +
      "  --muted: #586171;\n" +
      "  --line: rgba(74, 85, 104, 0.16);\n" +
      "  --accent: #1f6f5f;\n" +
      "  --accent-strong: #164f45;\n" +
      "  --warm: #d9a15b;\n" +
      "  font-family: 'Manrope', 'Segoe UI', sans-serif;\n" +
      "}\n\n" +
      "* { box-sizing: border-box; }\n\n" +
      "html { scroll-behavior: smooth; }\n\n" +
      "body {\n" +
      "  margin: 0;\n" +
      "  color: var(--ink);\n" +
      "  background:\n" +
      "    radial-gradient(circle at top left, rgba(217, 161, 91, 0.18), transparent 24%),\n" +
      "    radial-gradient(circle at 82% 18%, rgba(31, 111, 95, 0.14), transparent 20%),\n" +
      "    linear-gradient(180deg, #fbf8f1 0%, var(--bg) 100%);\n" +
      "}\n\n" +
      "a { color: inherit; text-decoration: none; }\n\n" +
      ".site-shell { min-height: 100vh; padding: 20px; }\n" +
      ".site-header { width: min(1160px, 100%); margin: 0 auto 24px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 18px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255, 252, 247, 0.78); backdrop-filter: blur(14px); box-shadow: 0 22px 60px rgba(74, 85, 104, 0.08); }\n" +
      ".brand { display: inline-flex; align-items: center; gap: 12px; font-weight: 800; letter-spacing: -0.03em; }\n" +
      ".brand-mark { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 14px; color: white; background: linear-gradient(135deg, var(--accent), var(--warm)); }\n" +
      ".site-nav { display: flex; flex-wrap: wrap; gap: 8px; }\n" +
      ".site-nav a { padding: 10px 14px; border-radius: 999px; color: var(--muted); border: 1px solid transparent; transition: transform 0.18s ease, border-color 0.18s ease, color 0.18s ease, background 0.18s ease; }\n" +
      ".site-nav a:hover { color: var(--ink); border-color: var(--line); background: rgba(255, 255, 255, 0.7); transform: translateY(-1px); }\n" +
      ".page-shell { width: min(1160px, 100%); margin: 0 auto; }\n" +
      ".hero { position: relative; overflow: hidden; padding: 44px; border-radius: 34px; border: 1px solid rgba(31, 111, 95, 0.12); background: linear-gradient(145deg, rgba(255, 253, 249, 0.94), rgba(245, 238, 225, 0.88)); box-shadow: 0 28px 90px rgba(74, 85, 104, 0.1); }\n" +
      ".hero::after { content: ''; position: absolute; inset: auto -8% -28% auto; width: 320px; height: 320px; border-radius: 999px; background: radial-gradient(circle, rgba(31, 111, 95, 0.16), transparent 68%); }\n" +
      ".eyebrow { display: inline-flex; padding: 8px 14px; border-radius: 999px; background: rgba(31, 111, 95, 0.08); color: var(--accent-strong); font-size: 0.82rem; font-weight: 700; }\n" +
      "h1 { margin: 18px 0 12px; font-size: clamp(3rem, 8vw, 5.6rem); line-height: 0.94; letter-spacing: -0.06em; max-width: 11ch; }\n" +
      ".lede { max-width: 60ch; margin: 0; color: var(--muted); font-size: 1.05rem; line-height: 1.8; }\n" +
      ".hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }\n" +
      ".button-primary, .button-secondary { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 18px; border-radius: 999px; font-weight: 700; transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease; }\n" +
      ".button-primary { color: white; background: linear-gradient(135deg, var(--accent), var(--accent-strong)); box-shadow: 0 18px 34px rgba(31, 111, 95, 0.22); }\n" +
      ".button-secondary { border: 1px solid var(--line); background: rgba(255, 255, 255, 0.72); }\n" +
      ".button-primary:hover, .button-secondary:hover { transform: translateY(-2px); }\n" +
      ".hero-grid, .detail-grid, .page-grid { display: grid; gap: 18px; }\n" +
      ".hero-grid { grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr); align-items: stretch; }\n" +
      ".stat-grid, .card-grid { display: grid; gap: 14px; }\n" +
      ".stat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 24px; }\n" +
      ".card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 18px; }\n" +
      ".card, .panel, .timeline-item { border: 1px solid var(--line); background: var(--paper); box-shadow: 0 18px 40px rgba(74, 85, 104, 0.06); }\n" +
      ".card, .panel { border-radius: 24px; padding: 20px; }\n" +
      ".card h2, .panel h2 { margin: 0 0 10px; font-size: 1rem; }\n" +
      ".card p, .panel p, .timeline-item p { margin: 0; color: var(--muted); line-height: 1.7; }\n" +
      ".metric { border-radius: 20px; padding: 18px; background: rgba(255, 255, 255, 0.7); border: 1px solid var(--line); }\n" +
      ".metric strong { display: block; margin-bottom: 6px; font-size: 1.3rem; }\n" +
      ".metric span { color: var(--muted); }\n" +
      ".section-block { margin-top: 18px; }\n" +
      ".section-title { margin: 0 0 10px; font-size: 1.15rem; letter-spacing: -0.03em; }\n" +
      ".timeline { display: grid; gap: 12px; }\n" +
      ".timeline-item { border-radius: 22px; padding: 18px; }\n" +
      ".timeline-item strong { display: block; margin-bottom: 6px; font-size: 1rem; }\n" +
      ".kicker { margin: 0 0 8px; color: var(--accent-strong); font-size: 0.82rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }\n" +
      "@media (max-width: 980px) { .hero-grid, .card-grid, .stat-grid, .page-grid { grid-template-columns: 1fr; } h1 { max-width: none; } }\n" +
      "@media (max-width: 720px) { .site-shell { padding: 14px; } .site-header, .hero, .card, .panel, .timeline-item { padding: 18px; } .site-header { border-radius: 28px; align-items: flex-start; } }\n" +
      "```\n\n" +
      "```tsx title=\"src/app/page.tsx\"\n" +
      "import Link from 'next/link';\n\n" +
      "const priorities = [\n" +
      "  { title: 'Weekly pulse', body: 'Track what is drifting before the team loses the week.' },\n" +
      "  { title: 'Clear decisions', body: 'Keep plan notes close to roadmap bets and meeting follow-ups.' },\n" +
      "  { title: 'Shared rhythm', body: 'Give every project lane a visible owner, next move, and confidence level.' },\n" +
      "];\n\n" +
      "const metrics = [\n" +
      "  { value: '12', label: 'active bets' },\n" +
      "  { value: '4', label: 'teams aligned' },\n" +
      "  { value: '92%', label: 'clarity score' },\n" +
      "];\n\n" +
      "export default function HomePage() {\n" +
      "  return (\n" +
      "    <main className=\"page-shell\">\n" +
      "      <section className=\"hero\">\n" +
      "        <div className=\"hero-grid\">\n" +
      "          <div>\n" +
      "            <div className=\"eyebrow\">Calm planning for focused teams</div>\n" +
      "            <h1>Plan calmer. Ship sooner.</h1>\n" +
      "            <p className=\"lede\">Northstar Planner turns scattered planning into a steady weekly rhythm with a clear header, durable routes, and a product surface that feels ready for real work.</p>\n" +
      "            <p className=\"lede\">The home page stays simple, but it now points toward roadmap reviews, shared notes, and the product story instead of leaving the starter untouched.</p>\n" +
      "            <div className=\"hero-actions\">\n" +
      "              <Link href=\"/roadmap\" className=\"button-primary\">Open roadmap</Link>\n" +
      "              <Link href=\"/notes\" className=\"button-secondary\">Read shared notes</Link>\n" +
      "            </div>\n" +
      "            <div className=\"stat-grid\">\n" +
      "              {metrics.map((metric) => (\n" +
      "                <article key={metric.label} className=\"metric\">\n" +
      "                  <strong>{metric.value}</strong>\n" +
      "                  <span>{metric.label}</span>\n" +
      "                </article>\n" +
      "              ))}\n" +
      "            </div>\n" +
      "          </div>\n" +
      "          <aside className=\"detail-grid\">\n" +
      "            <section className=\"panel\">\n" +
      "              <p className=\"kicker\">This week</p>\n" +
      "              <h2>Team direction</h2>\n" +
      "              <p>Overview keeps the product story tight, Roadmap tracks delivery, Notes captures decisions, and About explains why the product exists.</p>\n" +
      "            </section>\n" +
      "            <section className=\"panel\">\n" +
      "              <p className=\"kicker\">Signals</p>\n" +
      "              <h2>Useful from the second prompt</h2>\n" +
      "              <p>The app now has a real header and page structure, so the next prompt can add auth, team workspaces, or data-backed planning without resetting the surface.</p>\n" +
      "            </section>\n" +
      "          </aside>\n" +
      "        </div>\n" +
      "      </section>\n\n" +
      "      <section className=\"section-block\">\n" +
      "        <h2 className=\"section-title\">What improved</h2>\n" +
      "        <div className=\"card-grid\">\n" +
      "          {priorities.map((priority) => (\n" +
      "            <article key={priority.title} className=\"card\">\n" +
      "              <h2>{priority.title}</h2>\n" +
      "              <p>{priority.body}</p>\n" +
      "            </article>\n" +
      "          ))}\n" +
      "        </div>\n" +
      "      </section>\n" +
      "    </main>\n" +
      "  );\n" +
      "}\n" +
      "```\n\n" +
      "```tsx title=\"src/app/roadmap/page.tsx\"\n" +
      "const roadmapItems = [\n" +
      "  { quarter: 'Q1', title: 'Planner inbox', body: 'Unify incoming requests, notes, and owner handoffs in one queue.' },\n" +
      "  { quarter: 'Q2', title: 'Review rituals', body: 'Turn weekly planning into reusable review flows with clear prompts and summaries.' },\n" +
      "  { quarter: 'Q3', title: 'Signals dashboard', body: 'Show confidence, drift, and blocked work without turning the app into noise.' },\n" +
      "];\n\n" +
      "export default function RoadmapPage() {\n" +
      "  return (\n" +
      "    <main className=\"page-shell\">\n" +
      "      <section className=\"hero\">\n" +
      "        <div className=\"eyebrow\">Roadmap</div>\n" +
      "        <h1>Quarterly roadmap</h1>\n" +
      "        <p className=\"lede\">A calmer planning product still needs visible milestones. This route turns broad intent into sequenced bets with enough detail to guide delivery.</p>\n" +
      "      </section>\n" +
      "      <section className=\"section-block\">\n" +
      "        <div className=\"timeline\">\n" +
      "          {roadmapItems.map((item) => (\n" +
      "            <article key={item.quarter} className=\"timeline-item\">\n" +
      "              <p className=\"kicker\">{item.quarter}</p>\n" +
      "              <strong>{item.title}</strong>\n" +
      "              <p>{item.body}</p>\n" +
      "            </article>\n" +
      "          ))}\n" +
      "        </div>\n" +
      "      </section>\n" +
      "    </main>\n" +
      "  );\n" +
      "}\n" +
      "```\n\n" +
      "```tsx title=\"src/app/notes/page.tsx\"\n" +
      "const notes = [\n" +
      "  { title: 'Decision log', body: 'Capture why a roadmap bet changed before the context disappears.' },\n" +
      "  { title: 'Standup handoff', body: 'Summarize blockers, owners, and next actions in language the full team can reuse.' },\n" +
      "  { title: 'Customer signal', body: 'Keep direct evidence attached to the plan instead of letting it live in isolated chats.' },\n" +
      "];\n\n" +
      "export default function NotesPage() {\n" +
      "  return (\n" +
      "    <main className=\"page-shell\">\n" +
      "      <section className=\"hero\">\n" +
      "        <div className=\"eyebrow\">Notes</div>\n" +
      "        <h1>Shared notes</h1>\n" +
      "        <p className=\"lede\">This page keeps useful planning context readable, structured, and close to the roadmap work it informs.</p>\n" +
      "      </section>\n" +
      "      <section className=\"section-block\">\n" +
      "        <div className=\"card-grid\">\n" +
      "          {notes.map((note) => (\n" +
      "            <article key={note.title} className=\"card\">\n" +
      "              <h2>{note.title}</h2>\n" +
      "              <p>{note.body}</p>\n" +
      "            </article>\n" +
      "          ))}\n" +
      "        </div>\n" +
      "      </section>\n" +
      "    </main>\n" +
      "  );\n" +
      "}\n" +
      "```\n\n" +
      "```tsx title=\"src/app/about/page.tsx\"\n" +
      "const principles = [\n" +
      "  'Keep planning legible enough that new people can join mid-stream.',\n" +
      "  'Prefer fewer pages with clearer intent over dashboard sprawl.',\n" +
      "  'Make the weekly plan feel calm, not performative.',\n" +
      "];\n\n" +
      "export default function AboutPage() {\n" +
      "  return (\n" +
      "    <main className=\"page-shell\">\n" +
      "      <section className=\"hero\">\n" +
      "        <div className=\"eyebrow\">About</div>\n" +
      "        <h1>Why Northstar Planner</h1>\n" +
      "        <p className=\"lede\">Northstar Planner exists to make planning feel steady again: fewer scattered updates, fewer hidden decisions, and a clearer line between ideas and committed work.</p>\n" +
      "      </section>\n" +
      "      <section className=\"section-block\">\n" +
      "        <div className=\"timeline\">\n" +
      "          {principles.map((principle) => (\n" +
      "            <article key={principle} className=\"timeline-item\">\n" +
      "              <strong>{principle}</strong>\n" +
      "            </article>\n" +
      "          ))}\n" +
      "        </div>\n" +
      "      </section>\n" +
      "    </main>\n" +
      "  );\n" +
      "}\n" +
      "```";
  }

export function generateBuilderVinextUpgrade(desc: string): string {
    return "```json title=\"package.json\"\n" +
      JSON.stringify({
        name: 'vinext-scratch-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vinext dev',
          build: 'vinext build',
          start: 'vinext start'
        },
        dependencies: {
          vinext: 'latest',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          'framer-motion': '^12.7.4'
        },
        devDependencies: {
          '@types/node': '^22.10.1',
          '@types/react': '^19.0.0',
          '@vitejs/plugin-react': '^4.3.4',
          '@vitejs/plugin-rsc': 'latest',
          typescript: '^5.7.3',
          vite: '^7.0.0'
        }
      }, null, 2) +
      "\n```\n\n" +
      "```css title=\"src/app/globals.css\"\n" +
      ":root { color-scheme: dark; font-family: 'Sora', Inter, system-ui, sans-serif; --panel: rgba(9, 16, 31, 0.82); --panel-2: rgba(14, 24, 44, 0.78); --line: rgba(148, 163, 184, 0.14); --text: #ecf3ff; --muted: #99abc5; --accent: #67e8f9; --accent-2: #a78bfa; }\n" +
      "* { box-sizing: border-box; }\n" +
      "html { scroll-behavior: smooth; }\n" +
      "body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, rgba(103, 232, 249, 0.18), transparent 22%), radial-gradient(circle at 84% 14%, rgba(167, 139, 250, 0.2), transparent 24%), linear-gradient(180deg, #07111f 0%, #040814 48%, #02040a 100%); color: var(--text); }\n" +
      "body::before { content: ''; position: fixed; inset: 0; pointer-events: none; background-image: linear-gradient(rgba(148, 163, 184, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.05) 1px, transparent 1px); background-size: 30px 30px; mask-image: radial-gradient(circle at center, black 42%, transparent 88%); }\n" +
      "a { color: inherit; text-decoration: none; }\n" +
      "main { min-height: 100vh; padding: 28px 18px 80px; }\n" +
      ".frame { width: min(1180px, 100%); margin: 0 auto; }\n" +
      ".topbar { position: sticky; top: 18px; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border: 1px solid var(--line); border-radius: 20px; background: rgba(6, 10, 22, 0.72); backdrop-filter: blur(16px); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.25); }\n" +
      ".brand { display: flex; align-items: center; gap: 12px; font-weight: 600; }\n" +
      ".brand-mark { width: 34px; height: 34px; border-radius: 12px; display: grid; place-items: center; background: linear-gradient(135deg, rgba(103, 232, 249, 0.18), rgba(167, 139, 250, 0.24)); color: var(--accent); }\n" +
      ".nav { display: flex; flex-wrap: wrap; gap: 10px; }\n" +
      ".nav a { padding: 8px 12px; border-radius: 999px; color: var(--muted); border: 1px solid transparent; transition: border-color .18s ease, color .18s ease, transform .18s ease; }\n" +
      ".nav a:hover { color: var(--text); border-color: var(--line); transform: translateY(-1px); }\n" +
      ".hero { position: relative; overflow: hidden; margin-top: 18px; padding: 34px; border-radius: 32px; border: 1px solid var(--line); background: linear-gradient(145deg, rgba(9, 16, 31, 0.96), rgba(15, 26, 49, 0.88)); box-shadow: 0 32px 120px rgba(0, 0, 0, 0.34); }\n" +
      ".hero-grid { position: relative; display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(300px, 0.88fr); gap: 22px; align-items: stretch; }\n" +
      ".eyebrow { display: inline-flex; padding: 8px 14px; border-radius: 999px; background: rgba(103, 232, 249, 0.12); color: #b6f7ff; font-size: 13px; }\n" +
      "h1 { margin: 18px 0 12px; max-width: 11ch; font-size: clamp(3rem, 7vw, 5.7rem); line-height: 0.92; letter-spacing: -0.05em; }\n" +
      ".lede { max-width: 58ch; margin: 0; color: var(--muted); font-size: 1.02rem; line-height: 1.8; }\n" +
      ".actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }\n" +
      ".primary, .secondary { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; padding: 0 18px; border-radius: 999px; font-weight: 600; transition: transform .18s ease, border-color .18s ease; }\n" +
      ".primary { background: linear-gradient(135deg, #eff6ff, #dbeafe); color: #0f172a; }\n" +
      ".secondary { border: 1px solid rgba(148, 163, 184, 0.2); color: var(--text); }\n" +
      ".stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 22px; }\n" +
      ".stat { border-radius: 18px; border: 1px solid var(--line); background: rgba(6, 11, 23, 0.6); padding: 18px; }\n" +
      ".stat strong { display: block; margin-bottom: 6px; font-size: 1.1rem; }\n" +
      ".stat span { color: var(--muted); font-size: 0.92rem; line-height: 1.5; }\n" +
      ".hero-aside { display: grid; gap: 14px; }\n" +
      ".preview-board { border-radius: 24px; border: 1px solid var(--line); background: linear-gradient(180deg, rgba(6, 11, 23, 0.92), rgba(12, 20, 37, 0.82)); padding: 18px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); }\n" +
      ".preview-head { display: flex; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 0.82rem; margin-bottom: 14px; }\n" +
      ".preview-grid { display: grid; gap: 12px; }\n" +
      ".preview-row { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 12px; }\n" +
      ".preview-card { border-radius: 18px; border: 1px solid rgba(148, 163, 184, 0.12); background: rgba(15, 23, 42, 0.78); padding: 14px; }\n" +
      ".preview-card strong { display: block; margin-bottom: 8px; font-size: 0.94rem; }\n" +
      ".preview-card p { margin: 0; color: var(--muted); font-size: 0.9rem; line-height: 1.55; }\n" +
      ".mini-bars { display: grid; gap: 8px; margin-top: 10px; }\n" +
      ".mini-bars span { display: block; height: 8px; border-radius: 999px; background: linear-gradient(90deg, rgba(103, 232, 249, 0.82), rgba(167, 139, 250, 0.62)); opacity: 0.88; }\n" +
      ".mini-bars span:nth-child(2) { width: 78%; }\n" +
      ".mini-bars span:nth-child(3) { width: 62%; }\n" +
      ".panel { border-radius: 24px; border: 1px solid var(--line); background: var(--panel); padding: 20px; backdrop-filter: blur(12px); }\n" +
      ".panel h2 { margin: 0 0 12px; font-size: 1rem; }\n" +
      ".panel p { margin: 0; color: var(--muted); line-height: 1.65; }\n" +
      ".signal-list { display: grid; gap: 10px; margin-top: 16px; }\n" +
      ".signal { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 0.92rem; }\n" +
      ".signal span:last-child { color: var(--text); font-weight: 600; }\n" +
      ".showcase-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }\n" +
      ".showcase-card { position: relative; overflow: hidden; border-radius: 22px; border: 1px solid var(--line); background: linear-gradient(180deg, rgba(10, 18, 34, 0.92), rgba(15, 24, 43, 0.72)); padding: 18px; min-height: 180px; }\n" +
      ".showcase-card::after { content: ''; position: absolute; inset: auto -12% -24% auto; width: 180px; height: 180px; border-radius: 999px; background: radial-gradient(circle, rgba(103, 232, 249, 0.16), transparent 72%); }\n" +
      ".showcase-label { display: inline-flex; padding: 6px 10px; border-radius: 999px; background: rgba(103, 232, 249, 0.12); color: #b6f7ff; font-size: 0.78rem; }\n" +
      ".showcase-card h3 { margin: 14px 0 10px; font-size: 1.05rem; }\n" +
      ".showcase-card p { margin: 0; color: var(--muted); line-height: 1.65; }\n" +
      ".section-grid { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(300px, 0.88fr); gap: 18px; margin-top: 18px; }\n" +
      ".stack { display: grid; gap: 18px; }\n" +
      ".section-title { margin: 0 0 12px; font-size: 1.08rem; letter-spacing: -0.02em; }\n" +
      ".feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }\n" +
      ".feature { border-radius: 20px; border: 1px solid var(--line); background: var(--panel-2); padding: 18px; }\n" +
      ".feature h3 { margin: 0 0 10px; font-size: 1rem; }\n" +
      ".feature p { margin: 0; color: var(--muted); line-height: 1.65; }\n" +
      ".workflow { display: grid; gap: 12px; }\n" +
      ".step { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start; padding: 14px; border-radius: 18px; border: 1px solid var(--line); background: rgba(10, 17, 30, 0.72); }\n" +
      ".step-index { width: 28px; height: 28px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(103, 232, 249, 0.82), rgba(167, 139, 250, 0.82)); color: white; font-size: 0.84rem; font-weight: 700; }\n" +
      ".step strong { display: block; margin-bottom: 6px; font-size: 0.95rem; }\n" +
      ".step p { margin: 0; color: var(--muted); line-height: 1.6; }\n" +
      ".cta { display: flex; justify-content: space-between; gap: 18px; align-items: center; padding: 22px 24px; border-radius: 26px; border: 1px solid rgba(103, 232, 249, 0.16); background: linear-gradient(135deg, rgba(9, 16, 31, 0.92), rgba(18, 30, 55, 0.82)); }\n" +
      ".cta p { margin: 8px 0 0; color: var(--muted); max-width: 52ch; line-height: 1.7; }\n" +
      "code { font-family: 'JetBrains Mono', 'Fira Code', monospace; color: #c4b5fd; }\n" +
      "@media (max-width: 1080px) { .hero-grid, .section-grid, .feature-grid, .showcase-grid, .stats, .preview-row { grid-template-columns: 1fr; } h1 { max-width: none; } }\n" +
      "@media (max-width: 720px) { main { padding: 18px 14px 54px; } .topbar, .hero, .panel, .cta { padding: 18px; } .topbar, .cta { flex-direction: column; align-items: flex-start; } }\n" +
      "```\n\n" +
      "```tsx title=\"src/app/page.tsx\"\n" +
      "'use client';\n\n" +
      "import { motion, useMotionTemplate, useMotionValue, useSpring } from 'framer-motion';\n\n" +
      "const stats = [\n" +
      "  { value: 'Motion', label: 'load-in transitions across the hero' },\n" +
      "  { value: 'Hover', label: 'buttons and cards respond to intent' },\n" +
      "  { value: 'Sections', label: 'navigation maps to real content' },\n" +
      "  { value: 'Scalable', label: 'the shell is ready for future flows' },\n" +
      "];\n\n" +
      "const features = [\n" +
      "  { title: 'Real header and navigation', body: 'The top bar anchors the page and gives the layout a clearer sense of structure.' },\n" +
      "  { title: 'Mouse-reactive hero', body: 'The lead section tracks pointer movement with a soft radial glow so the page feels alive.' },\n" +
      "  { title: 'Reusable sections', body: 'Feature cards, workflow blocks, and a call-to-action area make the starter easier to expand.' },\n" +
      "];\n\n" +
      "const showcases = [\n" +
      "  { label: 'Flow', title: 'Launch narrative', body: 'The layout now has a clear start point, supporting sections, and a stronger sense of progression.' },\n" +
      "  { label: 'Motion', title: 'Micro-interactions', body: 'Buttons lift, cards respond, and the hero reacts to the pointer without becoming noisy.' },\n" +
      "  { label: 'Structure', title: 'Room to evolve', body: 'This shell can absorb pricing, onboarding, auth, or dashboard routes without a full rewrite.' },\n" +
      "];\n\n" +
      "const steps = [\n" +
      "  { title: 'Start from the base install', body: 'Keep the framework boot simple enough to validate before you add complexity.' },\n" +
      "  { title: 'Add hierarchy and motion', body: 'Introduce navigation, animated entrances, and richer sections without replacing the project.' },\n" +
      "  { title: 'Keep extending the same app', body: 'Add auth, pricing, dashboards, or data-backed flows on top of the same running shell.' },\n" +
      "];\n\n" +
      "const signals = [\n" +
      "  ['Navigation', 'Header, anchors, and route action'],\n" +
      "  ['Motion', 'Reveal timing and pointer glow'],\n" +
      "  ['Surface', 'Structured hero and stacked support panels'],\n" +
      "  ['Next step', 'Ready for another focused iteration'],\n" +
      "];\n\n" +
      "export default function HomePage() {\n" +
      "  const mouseX = useMotionValue(0);\n" +
      "  const mouseY = useMotionValue(0);\n" +
      "  const glowX = useSpring(mouseX, { stiffness: 120, damping: 24 });\n" +
      "  const glowY = useSpring(mouseY, { stiffness: 120, damping: 24 });\n" +
      "  const heroGlow = useMotionTemplate`radial-gradient(520px circle at ${glowX}px ${glowY}px, rgba(103, 232, 249, 0.16), transparent 60%)`;\n\n" +
      "  const handleMouseMove = (event: React.MouseEvent<HTMLElement>) => {\n" +
      "    const rect = event.currentTarget.getBoundingClientRect();\n" +
      "    mouseX.set(event.clientX - rect.left);\n" +
      "    mouseY.set(event.clientY - rect.top);\n" +
      "  };\n\n" +
      "  return (\n" +
      "    <main>\n" +
      "      <div className=\"frame\">\n" +
      "        <header className=\"topbar\">\n" +
      "          <div className=\"brand\">\n" +
      "            <div className=\"brand-mark\">Vx</div>\n" +
      "            <div>Vinext Starter</div>\n" +
      "          </div>\n" +
      "          <nav className=\"nav\">\n" +
      "            <a href=\"#overview\">Overview</a>\n" +
      "            <a href=\"#features\">Features</a>\n" +
      "            <a href=\"#workflow\">Workflow</a>\n" +
      "            <a href=\"/api/health\">Health</a>\n" +
      "          </nav>\n" +
      "        </header>\n" +
      "        <motion.section className=\"hero\" id=\"overview\" onMouseMove={handleMouseMove} initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: 'easeOut' }}>\n" +
      "          <motion.div aria-hidden style={{ background: heroGlow, position: 'absolute', inset: 0, pointerEvents: 'none' }} />\n" +
      "          <div className=\"hero-grid\">\n" +
      "            <div>\n" +
      "              <motion.div className=\"eyebrow\" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.35 }}>Starter upgraded</motion.div>\n" +
      "              <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.45 }}>A sharper product shell for the same Vinext app.</motion.h1>\n" +
      "              <p className=\"lede\">The starter now has a real header, a deliberate hero, and enough motion to feel active without overwhelming the layout.</p>\n" +
      "              <p className=\"lede\">Navigation, hover feedback, and pointer-reactive motion are layered into the existing starter so the app feels refined without losing the simplicity of the base install.</p>\n" +
      "              <div className=\"actions\">\n" +
      "                <motion.a whileHover={{ y: -2, scale: 1.01 }} whileTap={{ scale: 0.99 }} className=\"primary\" href=\"/api/health\">Open health route</motion.a>\n" +
      "                <motion.a whileHover={{ y: -2, scale: 1.01 }} whileTap={{ scale: 0.99 }} className=\"secondary\" href=\"#features\">Explore sections</motion.a>\n" +
      "              </div>\n" +
      "              <div className=\"stats\">\n" +
      "                {stats.map((stat, index) => (\n" +
      "                  <motion.article key={stat.label} className=\"stat\" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 + index * 0.08, duration: 0.35 }}>\n" +
      "                    <strong>{stat.value}</strong>\n" +
      "                    <span>{stat.label}</span>\n" +
      "                  </motion.article>\n" +
      "                ))}\n" +
      "              </div>\n" +
      "            </div>\n" +
      "            <aside className=\"hero-aside\">\n" +
      "              <section className=\"preview-board\">\n" +
      "                <div className=\"preview-head\">\n" +
      "                  <span>Preview board</span>\n" +
      "                  <span>Motion pass active</span>\n" +
      "                </div>\n" +
      "                <div className=\"preview-grid\">\n" +
      "                  <article className=\"preview-card\">\n" +
      "                    <strong>Hero pulse</strong>\n" +
      "                    <p>Pointer-reactive lighting and a restrained entrance sequence give the first fold more presence.</p>\n" +
      "                    <div className=\"mini-bars\"><span></span><span></span><span></span></div>\n" +
      "                  </article>\n" +
      "                  <div className=\"preview-row\">\n" +
      "                    <article className=\"preview-card\">\n" +
      "                      <strong>Navigation</strong>\n" +
      "                      <p>Anchors turn the page into a usable surface instead of a single static panel.</p>\n" +
      "                    </article>\n" +
      "                    <article className=\"preview-card\">\n" +
      "                      <strong>Responsiveness</strong>\n" +
      "                      <p>Cards reflow cleanly at mobile, tablet, and desktop widths.</p>\n" +
      "                    </article>\n" +
      "                  </div>\n" +
      "                </div>\n" +
      "              </section>\n" +
      "              <section className=\"panel\">\n" +
      "                <h2>Release overview</h2>\n" +
      "                <p>The page keeps the same starter foundation, but the surface now reads like the beginning of a real product instead of a blank install screen.</p>\n" +
      "                <div className=\"signal-list\">\n" +
      "                  {signals.map(([label, value]) => (\n" +
      "                    <div key={label} className=\"signal\">\n" +
      "                      <span>{label}</span>\n" +
      "                      <span>{value}</span>\n" +
      "                    </div>\n" +
      "                  ))}\n" +
      "                </div>\n" +
      "              </section>\n" +
      "              <section className=\"panel\">\n" +
      "                <h2>Design note</h2>\n" +
      "                <p>Subtle motion, clearer navigation, and stronger section rhythm push the app away from generic starter territory without making it feel overdesigned.</p>\n" +
      "              </section>\n" +
      "            </aside>\n" +
      "          </div>\n" +
      "        </motion.section>\n" +
      "        <section className=\"showcase-grid\">\n" +
      "          {showcases.map((card, index) => (\n" +
      "            <motion.article key={card.title} className=\"showcase-card\" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.25 }} transition={{ delay: index * 0.08, duration: 0.4 }}>\n" +
      "              <span className=\"showcase-label\">{card.label}</span>\n" +
      "              <h3>{card.title}</h3>\n" +
      "              <p>{card.body}</p>\n" +
      "            </motion.article>\n" +
      "          ))}\n" +
      "        </section>\n" +
      "        <section id=\"features\" className=\"section-grid\">\n" +
      "          <div className=\"stack\">\n" +
      "            <section className=\"panel\">\n" +
      "              <h2 className=\"section-title\">What changed in this pass</h2>\n" +
      "              <div className=\"feature-grid\">\n" +
      "                {features.map((feature, index) => (\n" +
      "                  <motion.article key={feature.title} className=\"feature\" initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ delay: index * 0.06, duration: 0.35 }} whileHover={{ y: -4 }}>\n" +
      "                    <h3>{feature.title}</h3>\n" +
      "                    <p>{feature.body}</p>\n" +
      "                  </motion.article>\n" +
      "                ))}\n" +
      "              </div>\n" +
      "            </section>\n" +
      "            <section className=\"cta\">\n" +
      "              <div>\n" +
      "                <strong>Keep iterating from this shell</strong>\n" +
      "                <p>Use the next Builder prompt to add pricing, authentication, product screenshots, dashboards, or data-backed routes on top of this same app.</p>\n" +
      "              </div>\n" +
      "              <a className=\"primary\" href=\"#workflow\">Continue building</a>\n" +
      "            </section>\n" +
      "          </div>\n" +
      "          <section className=\"panel\" id=\"workflow\">\n" +
      "            <h2 className=\"section-title\">Upgrade path</h2>\n" +
      "            <div className=\"workflow\">\n" +
      "              {steps.map((step, index) => (\n" +
      "                <article key={step.title} className=\"step\">\n" +
      "                  <div className=\"step-index\">{index + 1}</div>\n" +
      "                  <div>\n" +
      "                    <strong>{step.title}</strong>\n" +
      "                    <p>{step.body}</p>\n" +
      "                  </div>\n" +
      "                </article>\n" +
      "              ))}\n" +
      "            </div>\n" +
      "          </section>\n" +
      "        </section>\n" +
      "      </div>\n" +
      "    </main>\n" +
      "  );\n" +
      "}\n" +
      "```";
  }
