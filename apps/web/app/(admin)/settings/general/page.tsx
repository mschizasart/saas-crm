import { redirect } from 'next/navigation';

export default function SettingsGeneralRedirect() {
  redirect('/settings?tab=company');
}
