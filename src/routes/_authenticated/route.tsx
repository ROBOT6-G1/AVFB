import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard,
  MessageSquare,
  Sparkles,
  KeyRound,
  Facebook,
  MessagesSquare,
  Settings as SettingsIcon,
  LogOut,
  Bot,
  Send,
  GraduationCap,
  ShoppingBag,
  ClipboardList,
  Users,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getSettings } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") {
      return { user: null };
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

const COMMON_HEAD = [
  { to: "/dashboard", label: "Vue d'ensemble", icon: LayoutDashboard },
  { to: "/prompts", label: "Prompts IA", icon: Sparkles },
];
const COMMON_TAIL = [
  { to: "/api-keys", label: "Clés Gemini", icon: KeyRound },
  { to: "/facebook", label: "Facebook", icon: Facebook },
  { to: "/settings", label: "Paramètres", icon: SettingsIcon },
];

const NAV_BY_TYPE: Record<string, Array<{ to: string; label: string; icon: any }>> = {
  online_work: [
    ...COMMON_HEAD,
    { to: "/auto-post", label: "Auto-poste", icon: Send },
    { to: "/comments", label: "Commentaires", icon: MessagesSquare },
    { to: "/messages", label: "Messages", icon: MessageSquare },
    ...COMMON_TAIL,
  ],
  training: [
    ...COMMON_HEAD,
    { to: "/formations", label: "Formations", icon: GraduationCap },
    { to: "/payments", label: "Paiements", icon: CreditCard },
    { to: "/orders", label: "Commandes", icon: ClipboardList },
    { to: "/discussions", label: "Discussions", icon: Users },
    ...COMMON_TAIL,
  ],
  sales: [
    ...COMMON_HEAD,
    { to: "/produits", label: "Produits", icon: ShoppingBag },
    { to: "/payments", label: "Paiements", icon: CreditCard },
    { to: "/orders", label: "Commandes", icon: ClipboardList },
    { to: "/discussions", label: "Discussions", icon: Users },
    ...COMMON_TAIL,
  ],
};

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });
  const assistanceType = (settings as any)?.assistance_type ?? "online_work";
  const navItems = NAV_BY_TYPE[assistanceType] ?? NAV_BY_TYPE.online_work;

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success("Déconnecté");
    navigate({ to: "/auth" });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="hidden md:flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center gap-2 px-6 py-6 border-b border-sidebar-border">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-sidebar-foreground leading-tight">Assistante</div>
            <div className="text-xs text-muted-foreground">
              {assistanceType === "training"
                ? "Formation"
                : assistanceType === "sales"
                  ? "Vente"
                  : "Virtuelle IA"}
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Déconnexion
          </Button>
        </div>
      </aside>

      <div className="md:hidden fixed top-0 inset-x-0 z-40 flex items-center gap-2 border-b border-border bg-card/80 backdrop-blur px-4 py-3">
        <Bot className="h-5 w-5 text-primary" />
        <span className="font-semibold">Assistante Virtuelle</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={signOut}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      <main className="flex-1 min-w-0 pt-16 md:pt-0">
        <div className="max-w-6xl mx-auto p-6 md:p-8 pb-40 md:pb-8">
          <Outlet />
        </div>
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur grid grid-cols-5 gap-1 px-1 py-2">
          {navItems.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-col items-center gap-1 rounded-md py-1 px-1 text-[10px] ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate w-full text-center">{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </nav>
      </main>
    </div>
  );
}
