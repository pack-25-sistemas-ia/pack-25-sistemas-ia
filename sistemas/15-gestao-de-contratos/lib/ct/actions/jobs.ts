'use server';

import { z } from 'zod';
import { succeed, type ActionState } from '@/lib/actions/result';
import { runRpc, type SaveResult } from '../action-kit';
import { flag } from '../validation';

// Lembretes: execução manual pela gestão, antecedências por tipo de evento e token do agendador (proprietário). O token aparece UMA vez.
export async function runRemindersNow(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({}), 'manager', 'runRemindersNow', (_d, { ctx, org }) => ctx.supabase.rpc('ct_run_reminders_now', { p_org: org }),
    (data) => { const r = data as { sent: number; consolidated: number; errors: number }; return `Lembretes processados: ${r.sent} enviado(s), ${r.consolidated} consolidado(s), ${r.errors} erro(s).`; });
}

const offsetsText = z.string().trim().transform((s, ctx) => {
  const nums = s.split(/[s,;]+/).filter(Boolean).map(Number);
  if (nums.length < 1 || nums.length > 8 || nums.some((n) => !Number.isInteger(n) || n < 0 || n > 365)) { ctx.addIssue({ code: 'custom', message: 'Informe de 1 a 8 antecedências, em dias, entre 0 e 365 (ex.: 60, 30, 15, 7).' }); return z.NEVER; }
  return nums;
});
export async function saveReminderRule(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ event: z.enum(['contract_end', 'notice', 'adjustment', 'obligation']), offsets: offsetsText, active: flag.optional() }), 'manager', 'saveReminderRule',
    (d, { ctx, org }) => ctx.supabase.rpc('ct_save_reminder_rule', { p_org: org, p_event: d.event, p_offsets: d.offsets, p_active: d.active ?? false }), 'Antecedências salvas. Valem para os próximos processamentos.');
}

export async function rotateJobToken(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({}), 'owner', 'rotateJobToken', (_d, { ctx, org }) => ctx.supabase.rpc('ct_rotate_job_token', { p_org: org }),
    (token) => ({ ...succeed('Token gerado. Copie agora: ele não será mostrado de novo. O token anterior deixou de valer.'), values: { token: String(token) } }));
}
