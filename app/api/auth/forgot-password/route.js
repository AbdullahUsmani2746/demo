import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Resend } from "resend";
import { otpStore } from "@/lib/otpStore";

// const resend = new Resend(process.env.RESEND_API_KEY);
// const resend = new Resend("");


const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// export async function POST(req) {
//   try {
//     const { username, email, phone } = await req.json();

//     if (!username || !email || !phone) {
//       return NextResponse.json(
//         { error: "Username, email, and phone are required" },
//         { status: 400 }
//       );
//     }

//     const cleanUsername = username.trim();
//     const cleanEmail = email.trim();

//     const users = await prisma.$queryRaw`
//       SELECT * FROM "User" 
//       WHERE (username = ${cleanUsername} OR name = ${cleanUsername}) 
//       AND email = ${cleanEmail}
//     `;
//     const user = users[0];

//     if (user && user.phone && user.phone !== phone) {
//       return NextResponse.json(
//         { error: "Phone number does not match our records" },
//         { status: 400 }
//       );
//     }

//     if (!user) {
//       return NextResponse.json(
//         { error: "No matching user found with those details" },
//         { status: 404 }
//       );
//     }

//     const otp = generateOTP();
//     const expiresAt = Date.now() + 10 * 60 * 1000;
//     otpStore.set(email, { otp, expiresAt });

//     // Resend se email bhejna 
//     const { data, error } = await resend.emails.send({
//       from: "onboarding@resend.dev",
//       to: email,
//       subject: "Your Password Reset OTP",
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//           <h2 style="color: #333;">Password Reset Request</h2>
//           <p>Your OTP code is:</p>
//           <div style="background: #f4f4f4; padding: 20px; text-align: center; border-radius: 5px;">
//             <h1 style="color: #d32f2f; letter-spacing: 5px;">${otp}</h1>
//           </div>
//           <p>This OTP is valid for <strong>10 minutes</strong>.</p>
//           <p>If you didn't request this, please ignore this email.</p>
//         </div>
//       `,
//     });

//     if (error) {
//       console.error("Resend Error:", error);
//       return NextResponse.json(
//         { error: error.message },
//         { status: 500 }
//       );
//     }

//     console.log("✅ Email sent to:", email);
//     console.log("🔑 OTP:", otp);

//     return NextResponse.json({
//       message: "OTP sent to your email successfully",
//       success: true,
//     });

//   } catch (error) {
//     console.error("Error:", error);
//     return NextResponse.json(
//       { error: "An unexpected error occurred" },
//       { status: 500 }
//     );
//   }
// }