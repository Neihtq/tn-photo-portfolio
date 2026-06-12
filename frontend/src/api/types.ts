// Shared API response types — mirrors the backend contract. Every page/component
// imports from here so the parallel page builders agree on one shape.

export interface ApiImage {
  id: number;
  caption: string;
  width: number;
  height: number;
  thumb: string; // /api/images/:id/thumb
  full: string; // /api/images/:id/full
}

export interface ImagePage {
  images: ApiImage[];
  nextCursor: number | null; // null = no more pages
}

export interface HomeInfo {
  signature: string | null; // url or null
  instagram: { handle: string; url: string };
  name: string;
}

export interface Category {
  name: string;
  slug: string;
  thumbnail: string | null;
}

export interface AlbumSummary {
  name: string;
  subtitle: string;
  slug: string;
  thumbnail: string | null;
}

export interface CategoryAlbums {
  category: string;
  albums: AlbumSummary[];
}

export interface AlbumMeta {
  name: string;
  subtitle: string;
  slug: string;
  cover: string | null;
}

export type DownloadStatus =
  | { status: "pending" }
  | { status: "ready"; url: string; expiresAt: number }
  | { status: "error"; error: string }
  | { status: "expired" };

// Admin types
export interface AdminCategory {
  id: number;
  name: string;
  slug: string;
  thumbnail_image_id: number | null;
  sort_order: number;
}

export interface AdminAlbum {
  id: number;
  category_id: number | null;
  name: string;
  subtitle: string;
  slug: string;
  thumbnail_image_id: number | null;
  has_cover: number;
  is_private: number;
  sort_order: number;
  image_count?: number;
}

export interface AdminImage {
  id: number;
  albumId: number | null;
  caption: string;
  width: number;
  height: number;
  sortOrder: number;
  thumb: string;
  full: string;
  original: string;
}

export interface AdminSettings {
  siteName: string;
  instagramHandle: string;
  instagramUrl: string;
  hasSignature: boolean;
}

// About / Connect page content (configured via admin).
export interface AdminAbout {
  aboutTitle: string;
  aboutText: string;
  connectTitle: string;
  connectText: string;
  connectEmail: string;
  hasPortrait: boolean;
}

export interface PublicAbout {
  aboutTitle: string;
  aboutText: string;
  connectTitle: string;
  connectText: string;
  connectEmail: string;
  portrait: string | null;
  instagram: { handle: string; url: string };
}

// A selectable image for the admin visual thumbnail pickers.
export interface PickerImage {
  id: number;
  caption: string;
  albumId: number | null;
  albumName: string;
  thumb: string;
}
