// Thin fetch wrapper around the backend API. Same-origin in production (nginx),
// proxied in dev (vite). All requests send cookies for auth/unlock sessions.
import type {
  AdminAbout,
  AdminAlbum,
  AdminCategory,
  AdminImage,
  AdminSettings,
  AlbumMeta,
  Category,
  CategoryAlbums,
  DownloadStatus,
  HomeInfo,
  ImagePage,
  PickerImage,
  PublicAbout,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) code = j.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, code);
  }
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? await res.json() : (undefined as T)) as T;
}

/**
 * Upload via XMLHttpRequest so we can report real upload progress (fetch has no
 * upload-progress events). Resolves with parsed JSON; rejects with ApiError.
 */
function upload<T>(
  url: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(xhr.responseText ? JSON.parse(xhr.responseText) : (undefined as T));
        } catch {
          resolve(undefined as T);
        }
      } else {
        let code = `http_${xhr.status}`;
        try {
          const j = JSON.parse(xhr.responseText);
          if (j?.error) code = j.error;
        } catch {
          /* ignore */
        }
        reject(new ApiError(xhr.status, code));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network_error"));
    xhr.send(formData);
  });
}

function jsonInit(method: string, body?: unknown): RequestInit {
  // Only set the JSON content-type when there's actually a body — Fastify rejects
  // an empty body when content-type is application/json (bodyless POSTs 400'd).
  if (body === undefined) return { method };
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  // ---- public ----
  home: () => req<HomeInfo>("/api/home"),
  about: () => req<PublicAbout>("/api/about"),
  homeImages: (cursor = 0, limit = 24) =>
    req<ImagePage>(`/api/home/images?cursor=${cursor}&limit=${limit}`),
  categories: () => req<Category[]>("/api/categories"),
  categoryAlbums: (slug: string) => req<CategoryAlbums>(`/api/categories/${slug}/albums`),
  album: (slug: string) => req<AlbumMeta>(`/api/albums/${slug}`),
  albumImages: (slug: string, cursor = 0, limit = 24) =>
    req<ImagePage>(`/api/albums/${slug}/images?cursor=${cursor}&limit=${limit}`),

  // ---- private ----
  unlock: (slug: string, password: string) =>
    req<{ ok: true; name: string; subtitle: string }>(
      `/api/private/${slug}/unlock`,
      jsonInit("POST", { password }),
    ),
  privateAlbum: (slug: string) => req<AlbumMeta>(`/api/private/${slug}`),
  privateImages: (slug: string, cursor = 0, limit = 24) =>
    req<ImagePage>(`/api/private/${slug}/images?cursor=${cursor}&limit=${limit}`),
  startDownloadAll: (slug: string) =>
    req<{ jobToken: string; status: string }>(`/api/private/${slug}/download-all`, jsonInit("POST")),
  downloadStatus: (token: string) => req<DownloadStatus>(`/api/download/${token}/status`),
  // image variant URL helpers
  originalUrl: (id: number) => `/api/images/${id}/original`,

  // ---- admin ----
  adminLogin: (user: string, password: string) =>
    req<{ ok: true }>("/api/admin/login", jsonInit("POST", { user, password })),
  adminLogout: () => req<{ ok: true }>("/api/admin/logout", jsonInit("POST")),
  adminMe: () => req<{ ok: true }>("/api/admin/me"),

  adminSettings: () => req<AdminSettings>("/api/admin/settings"),
  saveSettings: (s: Partial<AdminSettings>) => req("/api/admin/settings", jsonInit("PUT", s)),
  uploadSignature: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req("/api/admin/signature", { method: "POST", body: fd });
  },
  deleteSignature: () => req("/api/admin/signature", { method: "DELETE" }),

  adminAbout: () => req<AdminAbout>("/api/admin/about"),
  saveAbout: (a: Partial<Omit<AdminAbout, "hasPortrait">>) =>
    req("/api/admin/about", jsonInit("PUT", a)),
  uploadPortrait: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req("/api/admin/about-portrait", { method: "POST", body: fd });
  },
  deletePortrait: () => req("/api/admin/about-portrait", { method: "DELETE" }),

  // All images for the visual thumbnail pickers.
  allImages: () => req<PickerImage[]>("/api/admin/images/all"),

  adminCategories: () => req<AdminCategory[]>("/api/admin/categories"),
  createCategory: (name: string) =>
    req<{ id: number; slug: string }>("/api/admin/categories", jsonInit("POST", { name })),
  updateCategory: (id: number, body: { name?: string; thumbnailImageId?: number | null }) =>
    req(`/api/admin/categories/${id}`, jsonInit("PUT", body)),
  deleteCategory: (id: number) => req(`/api/admin/categories/${id}`, { method: "DELETE" }),
  reorderCategories: (order: number[]) =>
    req("/api/admin/categories/reorder", jsonInit("POST", { order })),

  adminAlbums: () => req<AdminAlbum[]>("/api/admin/albums"),
  adminAlbum: (id: number) =>
    req<{ album: AdminAlbum; images: AdminImage[] }>(`/api/admin/albums/${id}`),
  createAlbum: (body: {
    name?: string;
    subtitle?: string;
    categoryId?: number | null;
    isPrivate?: boolean;
    password?: string;
  }) => req<{ id: number; slug: string }>("/api/admin/albums", jsonInit("POST", body)),
  updateAlbum: (
    id: number,
    body: {
      name?: string;
      subtitle?: string;
      categoryId?: number | null;
      thumbnailImageId?: number | null;
      isPrivate?: boolean;
      password?: string | null;
    },
  ) => req(`/api/admin/albums/${id}`, jsonInit("PUT", body)),
  deleteAlbum: (id: number) => req(`/api/admin/albums/${id}`, { method: "DELETE" }),

  // Album cover: a dedicated high-quality upload, kept out of the gallery.
  uploadCover: (albumId: number, file: File, onProgress?: (p: number) => void) => {
    const fd = new FormData();
    fd.append("file", file);
    return upload(`/api/admin/albums/${albumId}/cover`, fd, onProgress);
  },
  deleteCover: (albumId: number) =>
    req(`/api/admin/albums/${albumId}/cover`, { method: "DELETE" }),
  reorderAlbums: (order: number[]) => req("/api/admin/albums/reorder", jsonInit("POST", { order })),

  uploadImages: (
    files: FileList | File[],
    albumId?: number | null,
    onProgress?: (percent: number) => void,
  ) => {
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("file", f);
    const q = albumId != null ? `?albumId=${albumId}` : "";
    return upload<{ created: number[] }>(`/api/admin/images${q}`, fd, onProgress);
  },
  setCaption: (id: number, caption: string) =>
    req(`/api/admin/images/${id}/caption`, jsonInit("PUT", { caption })),
  deleteImage: (id: number) => req(`/api/admin/images/${id}`, { method: "DELETE" }),
  reorderImages: (order: number[], albumId: number | null) =>
    req("/api/admin/images/reorder", jsonInit("POST", { albumId, order })),
  sortImages: (albumId: number | null, by: "name" | "date", dir: "asc" | "desc") =>
    req<{ ok: true; count: number }>("/api/admin/images/sort", jsonInit("POST", { albumId, by, dir })),

  adminHome: () => req<AdminImage[]>("/api/admin/home"),
  addToHome: (imageIds: number[]) =>
    req<{ added: number[] }>("/api/admin/home/add", jsonInit("POST", { imageIds })),
  removeFromHome: (id: number) => req(`/api/admin/home/${id}`, { method: "DELETE" }),

  thumbUrl: (id: number) => `/api/images/${id}/thumb`,
};
