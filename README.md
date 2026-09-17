# Mermaid Live Lite

Một Mermaid Live Editor clone tối giản bằng React + Vite, chạy hoàn toàn phía client.

## Tính năng

- Live preview Mermaid
- Nhiều project/sơ đồ
- Tự lưu vào `localStorage`
- Import `.mmd`, `.mermaid`, `.txt`, `.md`
- Export `.mmd`
- Export SVG
- Copy Mermaid code
- Dark / Light mode
- Hiển thị lỗi cú pháp
- Không database, không API, không backend

## Yêu cầu

- Node.js 22.12+ khuyến nghị cho Mermaid 12
- npm

## Chạy local

```bash
npm install
npm run dev
```

Mở URL mà Vite hiển thị, thường là `http://localhost:5173`.

## Build

```bash
npm run build
```

Output nằm trong thư mục:

```text
dist/
```

## Deploy Vercel

### Cách 1 — GitHub

1. Push thư mục này lên GitHub.
2. Vào Vercel → Add New → Project.
3. Import repository.
4. Framework Preset: Vite.
5. Build Command: `npm run build`.
6. Output Directory: `dist`.
7. Deploy.

Không cần Environment Variables.

### Cách 2 — Vercel CLI

```bash
npm install -g vercel
vercel
```

Sau đó production:

```bash
vercel --prod
```

## Dữ liệu lưu ở đâu?

Project được lưu bằng `localStorage` trên chính trình duyệt.

Điều này có nghĩa:

- Không tốn database.
- Không tốn storage server.
- Vercel chỉ host static HTML/CSS/JS.
- Nếu xóa dữ liệu trình duyệt thì project local cũng mất.

Hãy dùng **Export .mmd** để backup những sơ đồ quan trọng.

## Cấu trúc

```text
mermaid-live-lite/
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
├── index.html
├── package.json
└── README.md
```

## Gợi ý nâng cấp

- Monaco Editor thay textarea
- Export PNG
- Zoom / pan preview
- Auto-save xuống GitHub
- Share bằng URL compressed state
- Folder/tag cho diagram
- Export "AI Context" gồm Mermaid + mô tả node
- Đồng bộ cloud/database
