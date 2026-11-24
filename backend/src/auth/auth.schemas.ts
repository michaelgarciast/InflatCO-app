import * as z from 'zod';

export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const signUpSchema = z.object({
  email: z.email(),
  password: z.string().min(12).max(256),
});

export const forgotPasswordSchema = z.object({
  email: z.email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12).max(256),
});

export type SignUpDto = z.infer<typeof signUpSchema>;
export type SignInDto = z.infer<typeof signInSchema>;
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
