import bcrypt from "bcryptjs"
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function main() { 
  // const users = [
  //   { 
  //     id: "27291",
  //     username: "27291",
  //     name: "Aamir Hirani",
  //     email: "emp27291@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27371",
  //     username: "27371",
  //     name: "Khurram Shahzad",
  //     email: "emp27371@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27373",
  //     username: "27373",
  //     name: "Imran",
  //     email: "emp27373@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27374",
  //     username: "27374",
  //     name: "Sameer",
  //     email: "emp27374@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27377",
  //     username: "27377",
  //     name: "Jazib Pirzada",
  //     email: "emp27377@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27388",
  //     username: "27388",
  //     name: "Jamal Ahmed",
  //     email: "emp27388@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27386",
  //     username: "27386",
  //     name: "Imtiaz Ali",
  //     email: "emp27386@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27391",
  //     username: "27391",
  //     name: "Qeemat ur Rehman",
  //     email: "emp27391@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27387",
  //     username: "27387",
  //     name: "Ali Muhammad",
  //     email: "emp27387@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27379",
  //     username: "27379",
  //     name: "Moazzam Abbas",
  //     email: "emp27379@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27381",
  //     username: "27381",
  //     name: "Saeed Ahmed Khan",
  //     email: "emp27381@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27384",
  //     username: "27384",
  //     name: "Muhammad Wasiq",
  //     email: "emp27384@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27573",
  //     username: "27573",
  //     name: "Yousuf Ali Imran",
  //     email: "emp27573@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "27674",
  //     username: "27674",
  //     name: "Syed Fasih Hashmi",
  //     email: "emp27674@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29037",
  //     username: "29037",
  //     name: "Shabee ul Hassan",
  //     email: "emp29037@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29038",
  //     username: "29038",
  //     name: "Bilal Ghani Khan",
  //     email: "emp29038@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29039",
  //     username: "29039",
  //     name: "Laung Khan",
  //     email: "emp29039@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29036",
  //     username: "29036",
  //     name: "Tooba Hammad",
  //     email: "emp29036@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29034",
  //     username: "29034",
  //     name: "Naveed Shah",
  //     email: "emp29034@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29040",
  //     username: "29040",
  //     name: "Ahsan ur Rehman",
  //     email: "emp29040@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29275",
  //     username: "29275",
  //     name: "Zahid Iqbal",
  //     email: "emp29275@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29311",
  //     username: "29311",
  //     name: "Moona Kaleem",
  //     email: "emp29311@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29361",
  //     username: "29361",
  //     name: "Rameen",
  //     email: "emp29361@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29475",
  //     username: "29475",
  //     name: "Shahzad Ahmed",
  //     email: "emp29475@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29463",
  //     username: "29463",
  //     name: "Jawad Nawaz",
  //     email: "emp29463@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   {
  //     id: "29462",
  //     username: "29462",
  //     name: "Shafiullah",
  //     email: "emp29462@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   },
  //   { 
  //     id: "29928",
  //     username: "29928",
  //     name: "Ijaz Ahmed",
  //     email: "emp29928@company.com",
  //     password: "admin123",
  //     role: "EMPLOYEE",
  //   }
  // ];

  const users = [
    { 
      id: "00001",
      username: "00001",
      name: "HAMZA BASHIR",
      email: "bizznextjs002@gmail.com",
      password: "admin123",
      role: "ACCOUNTANT",
    },
  ]


  for (const user of users) {
    const existing = await prisma.user.findUnique({ where: { email: user.email } });

    if (!existing) {
      await prisma.user.create({
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: true,
          password: await bcrypt.hash(user.password, 12),
        },
      });

      console.log('User created successfully')
      
    } else {
      console.log('User already exists')
      
    }
  }
}

main()
  .then(() => {
    
    return prisma.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });

// const settings = [
//   { key: "paymentMaster", value: "macno=27", exclude: false },
//   { key: "paymentDetail", value: "excludeMacno=003,004", exclude: true },

//   { key: "cashPaymentMaster", value: "macno=65", exclude: false },
//   { key: "cashPaymentDetail", value: "excludeMacno=003,004", exclude: true },

//   { key: "receiptMaster", value: "macno=27", exclude: false },
//   { key: "receiptDetail", value: "excludeMacno=27", exclude: true },

//   { key: "cashReceiptMaster", value: "macno=65", exclude: false },
//   { key: "cashReceiptDetail", value: "excludeMacno=003,004", exclude: true },

//   { key: "journalDetail", value: "excludeMacno=003,004", exclude: true },

//   { key: "purchaseMaster", value: "macno=006", exclude: false },
//   { key: "saleMaster", value: "macno=001", exclude: false },

//   { key: "purchaseReturnMaster", value: "macno=006", exclude: false },
//   { key: "saleReturnMaster", value: "macno=001", exclude: false },

//   { key: "purchaseOrderMaster", value: "macno=006", exclude: false },
//   { key: "saleOrderMaster", value: "macno=35", exclude: false },

//   { key: "grnMaster", value: "macno=006", exclude: false },
//   { key: "dispatchMaster", value: "macno=001", exclude: false },
// ];

// async function main() {
//   for (const setting of settings) {
//     const existing = await prisma.settings.findFirst({
//       where: {
//         key: setting.key,
//         value: setting.value,
//       },
//     });

//     if (!existing) {
//       await prisma.settings.create({ data: setting });
//       
//     } else {
//       
//         `Setting already exists: ${setting.key} → ${setting.value}`
//       );
//     }
//   }
// }

// main()
//   .then(() => prisma.$disconnect())
//   .catch((e) => {
//     console.error(e);
//     prisma.$disconnect();
//     process.exit(1);
//   });

const settings = [
  { key: "paymentMaster", value: "macno=27", exclude: false },
  { key: "paymentDetail", value: "excludeMacno=003,004", exclude: true },

  { key: "cashPaymentMaster", value: "macno=65", exclude: false },
  { key: "cashPaymentDetail", value: "excludeMacno=003,004", exclude: true },

  { key: "receiptMaster", value: "macno=27", exclude: false },
  { key: "receiptDetail", value: "excludeMacno=27", exclude: true },

  { key: "cashReceiptMaster", value: "macno=65", exclude: false },
  { key: "cashReceiptDetail", value: "excludeMacno=003,004", exclude: true },

  { key: "journalDetail", value: "excludeMacno=003,004", exclude: true },

  { key: "purchaseMaster", value: "macno=006", exclude: false },
  { key: "saleMaster", value: "macno=001", exclude: false },

  { key: "purchaseReturnMaster", value: "macno=006", exclude: false },
  { key: "saleReturnMaster", value: "macno=001", exclude: false },

  { key: "purchaseOrderMaster", value: "macno=006", exclude: false },
  { key: "saleOrderMaster", value: "macno=35", exclude: false },

  { key: "grnMaster", value: "macno=006", exclude: false },
  { key: "dispatchMaster", value: "macno=001", exclude: false },
];

// async function main() {
//   for (const setting of settings) {
//     const existing = await prisma.settings.findFirst({
//       where: {
//         key: setting.key,
//         value: setting.value,
//       },
//     });

//     if (!existing) {
//       await prisma.settings.create({ data: setting });
//       
//     } else {
//       
//         `Setting already exists: ${setting.key} → ${setting.value}`
//       );
//     }
//   }
// }

// main()
//   .then(() => prisma.$disconnect())
//   .catch((e) => {
//     console.error(e);
//     prisma.$disconnect();
//     process.exit(1);
//   });
