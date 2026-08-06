import { Shell } from '../../components/Shell';
import { TenantGuard } from '../../components/TenantGuard';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <TenantGuard>{children}</TenantGuard>
    </Shell>
  );
}
