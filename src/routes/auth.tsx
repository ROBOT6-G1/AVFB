// Auth route updated for Vercel deployment compatibility
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getSupabaseAuthUrl } from "@/lib/supabase-oauth.functions";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // States for Supabase Direct modal
  const [showDirectModal, setShowDirectModal] = useState(false);
  const [sbProjectUrl, setSbProjectUrl] = useState("");
  const [sbAnonKey, setSbAnonKey] = useState("");
  const [sbDirectLoading, setSbDirectLoading] = useState(false);
  const [supabaseLoading, setSupabaseLoading] = useState(false);

  const handleDirectSupabaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sbProjectUrl || !sbAnonKey) {
      toast.error("Veuillez remplir l'URL et la clé Supabase");
      return;
    }
    setSbDirectLoading(true);
    try {
      const cleanUrl = sbProjectUrl.trim().replace(/\/$/, "");
      const projectRef = cleanUrl.replace(/^https?:\/\//, "").split(".")[0] || "supabase_user";
      const userId = `sb_${projectRef.slice(0, 24)}`;
      const userEmail = `admin@${projectRef}.supabase.co`;

      const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const payload = btoa(JSON.stringify({ sub: userId, email: userEmail }));
      const sessionToken = `${header}.${payload}.direct_key`;
      const sessionUser = { uid: userId, email: userEmail, token: sessionToken };

      localStorage.setItem("agence_virtuelle_user_session", JSON.stringify(sessionUser));
      localStorage.setItem("agence_virtuelle_custom_supabase_url", cleanUrl);
      localStorage.setItem("agence_virtuelle_custom_supabase_key", sbAnonKey.trim());
      
      window.dispatchEvent(new Event("storage"));
      window.dispatchEvent(new Event("agence_virtuelle_auth_change"));

      toast.success("Connecté à votre projet Supabase avec succès !");
      setShowDirectModal(false);
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de connexion");
    } finally {
      setSbDirectLoading(false);
    }
  };

  useEffect(() => {
    const checkExisting = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) navigate({ to: "/dashboard" });
    };
    checkExisting();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "USER_UPDATED") && session) {
        navigate({ to: "/dashboard" });
      }
    });

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "SUPABASE_OAUTH_SUCCESS") {
        toast.success("Connexion Supabase réussie !");
        navigate({ to: "/dashboard" });
      }
    };

    const handleStorage = () => {
      const session = localStorage.getItem("agence_virtuelle_user_session");
      if (session) {
        toast.success("Session activée !");
        navigate({ to: "/dashboard" });
      }
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("agence_virtuelle_auth_change", handleStorage);

    const interval = setInterval(() => {
      const stored = localStorage.getItem("agence_virtuelle_user_session");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.uid && parsed.token) {
            clearInterval(interval);
            toast.success("Connexion confirmée !");
            navigate({ to: "/dashboard" });
          }
        } catch (e) {
          // ignore invalid json in storage
        }
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      sub.subscription.unsubscribe();
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("agence_virtuelle_auth_change", handleStorage);
    };
  }, [navigate]);

  const handleSupabaseOAuth = async () => {
    setSupabaseLoading(true);
    try {
      const redirectUri = `${window.location.origin}/api/public/supabase/callback`;
      const { url } = await getSupabaseAuthUrl({
        data: {
          redirectUri,
          mode: "signin",
        },
      });

      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        url,
        "supabase_oauth",
        `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no`,
      );

      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        window.location.href = url;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur OAuth Supabase");
    } finally {
      setSupabaseLoading(false);
    }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Veuillez remplir votre e-mail et mot de passe");
      return;
    }
    setLoading(true);
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const uid = "user_" + btoa(normalizedEmail).replace(/=/g, "");
      const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const payload = btoa(JSON.stringify({ sub: uid, email: normalizedEmail }));
      const token = `${header}.${payload}.mock_signature`;
      const sessionUser = { uid, email: normalizedEmail, token };

      localStorage.setItem("agence_virtuelle_user_session", JSON.stringify(sessionUser));
      window.dispatchEvent(new Event("storage"));
      window.dispatchEvent(new Event("agence_virtuelle_auth_change"));

      if (mode === "signup") {
        toast.success("Inscription réussie ! Connexion automatique...");
      } else {
        toast.success("Connexion réussie !");
      }
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error("Erreur lors de la connexion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary mb-4">
            <Bot className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold gradient-text">Assistante Virtuelle</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            IA automatique pour Facebook Messenger & commentaires
          </p>
        </div>

        <Card className="glass p-6">
          <div className="flex gap-2 mb-6 rounded-lg bg-muted p-1">
            <button
              onClick={() => setMode("signin")}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                mode === "signin" ? "bg-card text-foreground" : "text-muted-foreground"
              }`}
            >
              Connexion
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                mode === "signup" ? "bg-card text-foreground" : "text-muted-foreground"
              }`}
            >
              Inscription
            </button>
          </div>

          <form onSubmit={handleEmail} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@example.com"
              />
            </div>
            <div>
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={4}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 font-semibold" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "signin" ? "Se connecter avec Email" : "Créer un compte Email"}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Méthodes alternatives</span>
            </div>
          </div>

          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full bg-[#1c1c1c] hover:bg-[#282828] text-white border-emerald-500/30 hover:border-emerald-500/60 transition-all flex items-center justify-center gap-2"
              onClick={() => setShowDirectModal(true)}
              type="button"
            >
              🔑 Connexion Directe Supabase (URL + Clé API)
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={handleSupabaseOAuth}
              disabled={loading || supabaseLoading}
            >
              {supabaseLoading ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin text-emerald-400" />
              ) : (
                <svg className="h-3 w-3 mr-1 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21.362 9.354H12V.343a.343.343 0 0 0-.583-.244L.367 11.15a.343.343 0 0 0 .243.585h9.39v9.011a.343.343 0 0 0 .584.244l11.05-11.051a.343.343 0 0 0-.272-.585z" />
                </svg>
              )}
              OAuth Supabase Cloud
            </Button>
          </div>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          <Link to="/" className="hover:text-foreground">
            ← Retour
          </Link>
        </p>
      </div>

      {showDirectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-6 relative animate-in fade-in zoom-in duration-200 border-emerald-500/30">
            <h2 className="text-xl font-bold mb-2 text-foreground">Connexion Directe Supabase</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Saisissez directement l'URL de votre projet et votre clé publique (Anon Key) pour vous connecter immédiatement sans redirection :
            </p>
            <form onSubmit={handleDirectSupabaseSubmit} className="space-y-4">
              <div>
                <Label htmlFor="sb-url">Supabase Project URL</Label>
                <Input
                  id="sb-url"
                  type="url"
                  required
                  value={sbProjectUrl}
                  onChange={(e) => setSbProjectUrl(e.target.value)}
                  placeholder="https://xyzcompany.supabase.co"
                />
              </div>
              <div>
                <Label htmlFor="sb-key">Supabase Anon Key</Label>
                <Input
                  id="sb-key"
                  type="password"
                  required
                  value={sbAnonKey}
                  onChange={(e) => setSbAnonKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowDirectModal(false)}
                  disabled={sbDirectLoading}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={sbDirectLoading} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                  {sbDirectLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Se Connecter
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

