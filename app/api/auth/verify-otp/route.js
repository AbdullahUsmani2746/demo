import { NextResponse } from "next/server";
import { otpStore } from "@/lib/otpStore";

export async function POST(req) {
  try {
    const { email, otp } = await req.json();

    if (!email || !otp) {
      return NextResponse.json(
        { error: "Email and OTP are required" },
        { status: 400 }
      );
    }

    const record = otpStore.get(email);

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

    // OTP verified successfully
    // otpStore.delete(email);  

    return NextResponse.json({
      message: "OTP verified successfully",
      success: true,
      email,
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
