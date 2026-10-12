import { defineSignal } from '@temporalio/workflow';
import type { NotificationEmail } from '@gitroom/nestjs-libraries/emails/notification.email';

export type Email = NotificationEmail;

export const emailSignal = defineSignal<[Email[]]>('email');
