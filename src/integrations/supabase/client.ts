import { db, auth } from "@/integrations/firebase/config";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
} from "firebase/firestore";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";

// Local storage files helper
async function saveLocalFile(filename: string, base64: string): Promise<string> {
  if (typeof window === "undefined") {
    // Server-side: write directly to public/uploads
    const fs = await import("fs");
    const path = await import("path");
    const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    const safeName = filename.replace(/[^\w.\-]/g, "_");
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const filePath = path.join(UPLOAD_DIR, uniqueName);
    fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
    return `/uploads/${uniqueName}`;
  } else {
    // Client-side: call local upload API
    const res = await fetch("/api/public/upload-local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename, data_base64: base64 }),
    });
    if (!res.ok) {
      throw new Error("Failed to upload local file");
    }
    const json = await res.json();
    return json.path;
  }
}

class QueryBuilder {
  private colName: string;
  private filters: any[] = [];
  private orderField?: string;
  private orderAscending: boolean = true;
  private limitCount?: number;
  private relations: string[] = [];
  private pendingUpdateData?: any;
  private pendingDelete: boolean = false;

  constructor(colName: string) {
    this.colName = colName;
  }

  select(fields: string = "*") {
    if (fields.includes("product_images")) this.relations.push("product_images");
    if (fields.includes("training_files")) this.relations.push("training_files");
    if (fields.includes("trainings")) this.relations.push("trainings");
    if (fields.includes("products")) this.relations.push("products");
    if (fields.includes("facebook_pages")) this.relations.push("facebook_pages");
    return this;
  }

  eq(field: string, value: any) {
    if (value !== undefined && value !== null) {
      this.filters.push({ field, op: "==", value });
    }
    return this;
  }

  neq(field: string, value: any) {
    if (value !== undefined && value !== null) {
      this.filters.push({ field, op: "!=", value });
    }
    return this;
  }

  gte(field: string, value: any) {
    if (value !== undefined && value !== null) {
      this.filters.push({ field, op: ">=", value });
    }
    return this;
  }

  lte(field: string, value: any) {
    if (value !== undefined && value !== null) {
      this.filters.push({ field, op: "<=", value });
    }
    return this;
  }

  in(field: string, values: any[]) {
    if (values && values.length > 0) {
      this.filters.push({ field, op: "in", value: values });
    }
    return this;
  }

  or(queryStr: string) {
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderField = field;
    this.orderAscending = options?.ascending !== false;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  private async fetchJoinedRelations(data: any[]) {
    if (data.length === 0) return;

    try {
      const fetchDocs = async (colName: string) => {
        const snapshot = await getDocs(collection(db, colName));
        return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      };

      if (this.relations.includes("product_images")) {
        const allImages = await fetchDocs("product_images");
        for (const item of data) {
          item.product_images = allImages.filter((img: any) => img.product_id === item.id);
        }
      }

      if (this.relations.includes("training_files")) {
        const allFiles = await fetchDocs("training_files");
        for (const item of data) {
          item.training_files = allFiles.filter((f: any) => f.training_id === item.id);
        }
      }

      if (this.relations.includes("trainings") || this.relations.includes("products")) {
        const allTrainings = await fetchDocs("trainings");
        const allProducts = await fetchDocs("products");
        for (const item of data) {
          if (this.relations.includes("trainings")) {
            item.trainings = allTrainings.find((t: any) => t.id === item.training_id) || null;
          }
          if (this.relations.includes("products")) {
            item.products = allProducts.find((p: any) => p.id === item.product_id) || null;
          }
        }
      }

      if (this.relations.includes("facebook_pages")) {
        const allPages = await fetchDocs("facebook_pages");
        for (const item of data) {
          item.facebook_pages =
            allPages.find((p: any) => p.page_id === item.page_id || p.id === item.page_id) || null;
        }
      }
    } catch (e) {
      console.warn("Failed to join relations:", e);
    }
  }

  async then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    try {
      let snapshot;
      try {
        let q = query(collection(db, this.colName));
        for (const f of this.filters) {
          q = query(q, where(f.field, f.op, f.value));
        }
        if (this.orderField) {
          q = query(q, orderBy(this.orderField, this.orderAscending ? "asc" : "desc"));
        }
        if (this.limitCount !== undefined) {
          q = query(q, firestoreLimit(this.limitCount));
        }
        snapshot = await getDocs(q);
      } catch (indexError) {
        // Fallback: try querying by user_id if present, otherwise fetch entire collection
        const userFilter = this.filters.find((f) => f.field === "user_id" && f.op === "==");
        if (userFilter) {
          snapshot = await getDocs(query(collection(db, this.colName), where("user_id", "==", userFilter.value)));
        } else {
          snapshot = await getDocs(collection(db, this.colName));
        }
      }

      let data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      // In-memory filtering to guarantee complete correctness regardless of index missing
      for (const f of this.filters) {
        if (f.op === "==") {
          data = data.filter((item: any) => item[f.field] === f.value);
        } else if (f.op === "!=") {
          data = data.filter((item: any) => item[f.field] !== f.value);
        } else if (f.op === ">=") {
          data = data.filter((item: any) => item[f.field] >= f.value);
        } else if (f.op === "<=") {
          data = data.filter((item: any) => item[f.field] <= f.value);
        } else if (f.op === "in") {
          data = data.filter((item: any) => Array.isArray(f.value) && f.value.includes(item[f.field]));
        }
      }

      // In-memory sorting
      if (this.orderField) {
        const field = this.orderField;
        const asc = this.orderAscending;
        data.sort((a: any, b: any) => {
          const valA = a[field];
          const valB = b[field];
          if (valA === undefined || valA === null) return asc ? -1 : 1;
          if (valB === undefined || valB === null) return asc ? 1 : -1;
          if (valA < valB) return asc ? -1 : 1;
          if (valA > valB) return asc ? 1 : -1;
          return 0;
        });
      }

      // In-memory limit
      if (this.limitCount !== undefined && data.length > this.limitCount) {
        data = data.slice(0, this.limitCount);
      }

      if (this.pendingUpdateData !== undefined) {
        const updated = [];
        const updated_at = new Date().toISOString();
        for (const item of data) {
          const updateData = { ...this.pendingUpdateData, updated_at };
          const docRef = doc(db, this.colName, item.id);
          await updateDoc(docRef, updateData);
          updated.push({ ...item, ...updateData });
        }
        const result = { data: updated, error: null };
        return onfulfilled ? onfulfilled(result) : result;
      }

      if (this.pendingDelete) {
        for (const item of data) {
          await deleteDoc(doc(db, this.colName, item.id));
        }
        const result = { data, error: null };
        return onfulfilled ? onfulfilled(result) : result;
      }

      await this.fetchJoinedRelations(data);

      const result = { data, error: null };
      return onfulfilled ? onfulfilled(result) : result;
    } catch (err: any) {
      console.error("Firestore query error:", err);
      const result = { data: null, error: err };
      return onrejected ? onrejected(err) : result;
    }
  }

  async single() {
    const res = await this.then();
    if (res.error) return { data: null, error: res.error };
    if (!res.data || res.data.length === 0) {
      return { data: null, error: new Error("No record found") };
    }
    return { data: res.data[0], error: null };
  }

  async maybeSingle() {
    const res = await this.then();
    if (res.error) return { data: null, error: res.error };
    return { data: res.data && res.data.length > 0 ? res.data[0] : null, error: null };
  }

  async insert(data: any) {
    try {
      const items = Array.isArray(data) ? data : [data];
      const inserted = [];

      for (const item of items) {
        const id = item.id || crypto.randomUUID();
        const created_at = item.created_at || new Date().toISOString();
        const updated_at = item.updated_at || new Date().toISOString();
        const docData = { ...item, id, created_at, updated_at };

        await setDoc(doc(db, this.colName, id), docData);
        inserted.push(docData);
      }
      return { data: inserted, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }

  update(data: any) {
    this.pendingUpdateData = data;
    return this;
  }

  delete() {
    this.pendingDelete = true;
    return this;
  }

  async upsert(data: any, options?: { onConflict?: string }) {
    try {
      const items = Array.isArray(data) ? data : [data];
      const upserted = [];

      for (const item of items) {
        let id = item.id;
        let existingDoc: any = null;

        // 1. If an ID is provided, check if it already exists in Firestore
        if (id) {
          const docRef = doc(db, this.colName, id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            existingDoc = docSnap;
          }
        } 
        // 2. Otherwise, if onConflict is specified, look up the document by those fields
        else if (options?.onConflict) {
          const keys = options.onConflict.split(",");
          let q = query(collection(db, this.colName));
          let hasAllKeys = true;
          for (const key of keys) {
            const trimmedKey = key.trim();
            if (item[trimmedKey] !== undefined) {
              q = query(q, where(trimmedKey, "==", item[trimmedKey]));
            } else {
              hasAllKeys = false;
            }
          }
          if (hasAllKeys) {
            const snapshot = await getDocs(query(q, firestoreLimit(1)));
            if (!snapshot.empty) {
              existingDoc = snapshot.docs[0];
              id = existingDoc.id;
            }
          }
        }

        // 3. Fallback to generating a new ID if none found
        if (!id) {
          id = crypto.randomUUID();
        }

        const created_at = item.created_at || (existingDoc ? existingDoc.data().created_at : null) || new Date().toISOString();
        const updated_at = new Date().toISOString();

        // Merge existing document fields with the incoming item so we NEVER erase other properties
        const existingData = existingDoc ? existingDoc.data() : {};
        const docData = {
          ...existingData,
          ...item,
          id,
          created_at,
          updated_at,
        };

        const docRef = doc(db, this.colName, id);
        await setDoc(docRef, docData, { merge: true });
        upserted.push(docData);
      }
      return { data: upserted, error: null };
    } catch (err: any) {
      console.error("Firestore upsert error:", err);
      return { data: null, error: err };
    }
  }
}

class StorageBuilder {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  async upload(pathStr: string, file: any, options?: any) {
    try {
      let filename = pathStr.split("/").pop() || "file.jpg";
      let base64 = "";

      if (typeof window !== "undefined" && (file instanceof File || file instanceof Blob)) {
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const res = reader.result as string;
            resolve(res.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        if (file instanceof File) {
          filename = file.name;
        }
      } else if (file instanceof Uint8Array) {
        base64 = btoa(String.fromCharCode(...file));
      } else if (typeof file === "string") {
        base64 = file;
      } else {
        base64 = btoa(file.toString());
      }

      const publicPath = await saveLocalFile(filename, base64);
      return { data: { path: publicPath }, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }

  async createSignedUrl(pathStr: string, expires: number) {
    // Stored locally as public path
    const url = pathStr.startsWith("/") ? pathStr : `/uploads/${pathStr.split("/").pop()}`;
    return { data: { signedUrl: url }, error: null };
  }

  async createSignedUploadUrl(pathStr: string) {
    const url = `/uploads/${pathStr.split("/").pop()}`;
    return { data: { token: "local-token", signedUrl: url }, error: null };
  }

  async remove(paths: string[]) {
    // Best effort: server-side deletion of files
    if (typeof window === "undefined") {
      const fs = await import("fs");
      const path = await import("path");
      const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
      for (const p of paths) {
        try {
          const filename = p.split("/").pop();
          if (filename) {
            const filePath = path.join(UPLOAD_DIR, filename);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        } catch (e) {
          console.warn("Failed to delete local file:", p, e);
        }
      }
    }
    return { data: paths, error: null };
  }
}

const isCustomDomain =
  typeof window !== "undefined" &&
  !window.location.hostname.includes("localhost") &&
  !window.location.hostname.includes("127.0.0.1") &&
  !window.location.hostname.includes(".run.app");

const getCustomDomainSession = () => {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem("agence_virtuelle_user_session");
  if (!stored) return null;
  try {
    const session = JSON.parse(stored);
    if (session && session.uid && session.email && session.token) {
      return session;
    }
  } catch {
    return null;
  }
  return null;
};

const mockSupabase = {
  from: (tableName: string) => {
    return new QueryBuilder(tableName);
  },
  storage: {
    from: (bucket: string) => {
      return new StorageBuilder(bucket);
    },
  },
  auth: {
    getUser: async () => {
      if (typeof window === "undefined") {
        return { data: { user: null }, error: null };
      }
      
      const customSession = getCustomDomainSession();
      if (customSession) {
        return {
          data: {
            user: {
              id: customSession.uid,
              email: customSession.email,
            },
          },
          error: null,
        };
      }

      let user = auth.currentUser;
      if (!user) {
        user = await new Promise((resolve) => {
          const unsubscribe = onAuthStateChanged(auth, (u) => {
            unsubscribe();
            resolve(u);
          });
        });
      }
      return {
        data: {
          user: user
            ? {
                id: user.uid,
                email: user.email,
              }
            : null,
        },
        error: null,
      };
    },
    getSession: async () => {
      if (typeof window === "undefined") {
        return { data: { session: null }, error: null };
      }

      const customSession = getCustomDomainSession();
      if (customSession) {
        return {
          data: {
            session: {
              access_token: customSession.token,
              user: {
                id: customSession.uid,
                email: customSession.email,
              },
            },
          },
          error: null,
        };
      }

      let user = auth.currentUser;
      if (!user) {
        user = await new Promise((resolve) => {
          const unsubscribe = onAuthStateChanged(auth, (u) => {
            unsubscribe();
            resolve(u);
          });
        });
      }
      const token = user ? await user.getIdToken() : null;
      return {
        data: {
          session: user
            ? {
                access_token: token,
                user: {
                  id: user.uid,
                  email: user.email,
                },
              }
            : null,
        },
        error: null,
      };
    },
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      // Firebase auth state listener
      const unsub = onAuthStateChanged(auth, async (user) => {
        const customSession = getCustomDomainSession();
        if (customSession && !user) {
          callback("SIGNED_IN", {
            access_token: customSession.token,
            user: {
              id: customSession.uid,
              email: customSession.email,
            },
          });
          return;
        }

        const token = user ? await user.getIdToken() : null;
        const session = user
          ? {
              access_token: token,
              user: {
                id: user.uid,
                email: user.email,
              },
            }
          : null;
        callback(user ? "SIGNED_IN" : "SIGNED_OUT", session);
      });

      // Storage event listener for custom domains
      let handleStorage: (() => void) | null = null;
      if (typeof window !== "undefined") {
        handleStorage = () => {
          const customSession = getCustomDomainSession();
          if (customSession) {
            callback("SIGNED_IN", {
              access_token: customSession.token,
              user: {
                id: customSession.uid,
                email: customSession.email,
              },
            });
          } else if (!auth.currentUser) {
            callback("SIGNED_OUT", null);
          }
        };
        window.addEventListener("storage", handleStorage);
        window.addEventListener("agence_virtuelle_auth_change", handleStorage);
      }

      return {
        data: {
          subscription: {
            unsubscribe: () => {
              unsub();
              if (handleStorage) {
                window.removeEventListener("storage", handleStorage);
                window.removeEventListener("agence_virtuelle_auth_change", handleStorage);
              }
            },
          },
        },
      };
    },
    signUp: async ({ email, password }: any) => {
      try {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        return { data: { user: { id: res.user.uid, email: res.user.email } }, error: null };
      } catch (err: any) {
        return { data: null, error: err };
      }
    },
    signInWithPassword: async ({ email, password }: any) => {
      try {
        const res = await signInWithEmailAndPassword(auth, email, password);
        return { data: { user: { id: res.user.uid, email: res.user.email } }, error: null };
      } catch (err: any) {
        return { data: null, error: err };
      }
    },
    signOut: async () => {
      try {
        if (typeof window !== "undefined") {
          localStorage.removeItem("agence_virtuelle_user_session");
          window.dispatchEvent(new Event("storage"));
          window.dispatchEvent(new Event("agence_virtuelle_auth_change"));
        }
        await signOut(auth);
        return { error: null };
      } catch (err: any) {
        return { error: err };
      }
    },
  },
};

export const supabase = mockSupabase as any;
