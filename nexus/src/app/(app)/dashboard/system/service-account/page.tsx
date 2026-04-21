import { redirect } from 'next/navigation';
export default function Page() {
  redirect('/dashboard/cluster/access?tab=service-account');
}
