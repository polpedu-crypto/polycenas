from prisma import Prisma

prisma = Prisma()


async def connect_db():
    if not prisma.is_connected():
        await prisma.connect()


async def disconnect_db():
    if prisma.is_connected():
        await prisma.disconnect()
