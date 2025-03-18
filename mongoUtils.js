import { MongoClient, ObjectId } from 'mongodb';

const url = "mongodb+srv://user:user@cluster-website.5knvo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster-website";
const databaseName = "document";
const collectionName = "tech-team";

const client = new MongoClient(url);

async function connectToDatabase() {
    try {
        await client.connect();
        console.log('Successfully connected to MongoDB.');
        return client.db(databaseName);
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        throw error;
    }
}

async function getAllDocuments() {
    try {
        const database = await connectToDatabase();
        const collection = database.collection(collectionName);
        return await collection.find({}).toArray();
    } catch (error) {
        console.error('Error fetching documents:', error);
        throw error;
    }
}

async function getPdfById(id) {
    try {
        const database = await connectToDatabase();
        const collection = database.collection(collectionName);
        return await collection.findOne({ _id: new ObjectId(id) });
    } catch (error) {
        console.error('Error fetching PDF:', error);
        throw error;
    }
}

// Export functions using ES module syntax
export { getAllDocuments, getPdfById, connectToDatabase };
