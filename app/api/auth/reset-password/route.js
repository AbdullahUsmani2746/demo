import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { otpStore } from "@/lib/otpStore";
import bcrypt from "bcryptjs";

export async function POST(req) {
  try {
    const { email, otp, newPassword } = await req.json();

    if (!email || !otp || !newPassword) {
      return NextResponse.json(
        { error: "Email, OTP and new password are required" },
        { status: 400 }
      );
    }

    // Verify OTP
    const record = otpStore.get(email);
    console.log(otpStore);
    if (!record) {
      return NextResponse.json(
        { error: "Invalid or expired OTP" },
        { status: 400 }
      );
    }
    if (Date.now() > record.expiresAt) {
      otpStore.delete(email);
      return NextResponse.json(
        { error: "OTP has expired" },
        { status: 400 }
      );
    }
    if (record.otp !== otp) {
      return NextResponse.json(
        { error: "Incorrect OTP" },
        { status: 400 }
      );
    }

    // OTP is valid – update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.$executeRaw`
      UPDATE "User"
      SET password = ${hashedPassword}
      WHERE email = ${email}
    `;

    // Clean up OTP
    otpStore.delete(email);

    return NextResponse.json({
      message: "Password has been reset successfully",
      success: true,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
