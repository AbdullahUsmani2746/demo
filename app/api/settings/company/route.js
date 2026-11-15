import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_LOGO, clearCompanyCache } from "@/lib/company";

// GET - Fetch company settings
export async function GET() {
  try {
    // Get first company (assuming single company setup)
    const company = await prisma.company.findFirst({
      select: {
        id: true,
        company: true,
        logo: true,
        addr1: true,
        addr2: true,
        city: true,
        phone: true,
        fax: true,
        email: true,
      },
    });

    // If no company exists, return a neutral, empty profile — never another
    // company's details. The user fills it in under Settings → Company.
    if (!company) {
      return NextResponse.json({
        data: {
          id: null,
          company: DEFAULT_COMPANY_NAME,
          logo: DEFAULT_COMPANY_LOGO,
          addr1: "",
          addr2: "",
          city: "",
          phone: "",
          fax: "",
          email: "",
          address: [],
        },
        status: 200,
      });
    }

    // Format address array for PDF templates
    const address = [];
    if (company.addr1) address.push(company.addr1);
    if (company.addr2) address.push(company.addr2);
    if (company.city) address.push(company.city);
    if (company.phone) address.push(`Phone: ${company.phone}`);

    return NextResponse.json({
      data: {
        ...company,
        address,
      },
      status: 200,
    });
  } catch (error) {
    console.error("Company fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch company settings" },
      { status: 500 }
    );
  }
}

// PUT - Update company settings
export const PUT = guard("settings.manage", async (request) => {
  try {
    const body = await request.json();
    const { id, company, logo, addr1, addr2, city, phone, fax, email } = body;

    if (!company) {
      return NextResponse.json(
        { error: "Company name is required" },
        { status: 400 }
      );
    }

    let updatedCompany;

    if (id) {
      // Update existing company
      updatedCompany = await prisma.company.update({
        where: { id: Number(id) },
        data: {
          company,
          logo: logo || DEFAULT_COMPANY_LOGO,
          addr1,
          addr2,
          city,
          phone,
          fax,
          email,
        },
      });
    } else {
      // Create new company
      updatedCompany = await prisma.company.create({
        data: {
          company,
          logo: logo || DEFAULT_COMPANY_LOGO,
          addr1,
          addr2,
          city,
          phone,
          fax,
          email,
        },
      });
    }

    clearCompanyCache();

    return NextResponse.json({
      data: updatedCompany,
      status: 200,
    });
  } catch (error) {
    console.error("Company update error:", error);
    return NextResponse.json(
      { error: "Failed to update company" },
      { status: 500 }
    );
  }
});