require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000



const admin = require("firebase-admin");

const serviceAccount = require("./firebase-secret-key.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});




// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ojps7gr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});



const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    //  console.log("Authorization header:", authHeader); 

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized: No token provided" });
    }

    const idToken = authHeader.split(" ")[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);

        req.firebaseUser = decodedToken;
        next();
    } catch (error) {
        return res
            .status(401)
            .json({ message: "Unauthorized: Invalid token from catch" });
    }
};


async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();


        const db = client.db('unitSphereDB');
        const apartmentsCollection = db.collection('apartments');
        const agreementCollection = db.collection('agreement')
        const usersCollection = db.collection('users')
        const announcementCollection = db.collection('announcements');


        const verifyAdmin = async (req, res, next) => {
            const user = await usersCollection.findOne({
                email: req.firebaseUser.email,
            });

            if (user.role === "admin") {
                next();
            } else {
                res.status(403).send({ msg: "unauthorized" });
            }
        };


        // GET API for apartments with pagination and rent range
        app.get('/apartments', async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 6;
            const skip = (page - 1) * limit;

            const minRent = parseFloat(req.query.minRent);
            const maxRent = parseFloat(req.query.maxRent);

            let query = {};

            if (!isNaN(minRent) && !isNaN(maxRent)) {
                query.rent = { $gte: minRent, $lte: maxRent };
            }

            const total = await apartmentsCollection.countDocuments(query);

            const apartments = await apartmentsCollection
                .find(query)
                .skip(skip)
                .limit(limit)
                .toArray();

            res.send({
                apartments,
                total,
            });
        });


        // GET: user role 

        app.get("/user-role", verifyFirebaseToken, async (req, res) => {
            // console.log(req.firebaseUser);

            const user = await usersCollection.findOne({ email: req.firebaseUser.email })
            res.send({ msg: "ok", role: user.role })

        })


        // GET: all user for admin 




        app.get("/users", verifyFirebaseToken, verifyAdmin,
            //      async (req, res) => {

            //     const users = await usersCollection.find({}).toArray();
            //     res.send(users)

            // }
            async (req, res) => {
                const users = await usersCollection
                    .find({ email: { $ne: req.firebaseUser.email } })
                    .toArray();
                res.send(users);
            }
        )

        // GET: pending requests 

        app.get("/agreements/pending", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const requests = await agreementCollection.find({ status: "pending" }).toArray();
            res.send(requests);
        });


        // post agreement /
        app.post('/agreements', async (req, res) => {
            const agreement = req.body;
            const { userEmail } = agreement;

            try {

                const existing = await agreementCollection.findOne({ userEmail });

                if (existing) {
                    return res.status(400).send({ error: true, message: 'User has already applied for an apartment.' });
                }

                const result = await agreementCollection.insertOne(agreement);
                res.send({ insertedId: result.insertedId });
            } catch (err) {
                res.status(500).send({ error: true, message: 'Internal Server Error' });
            }
        });

        // POST: user 

        app.post("/add-user", async (req, res) => {
            const userData = req.body;

            console.log(userData);

            const find_result = await usersCollection.findOne({
                email: userData.email,
            })

            if (find_result) {
                res.send({ msg: "user already exist" })
            } else {
                const result = await usersCollection.insertOne(userData)
                res.send(result)
            }

        })


        // POST: create an announcement
        app.post("/announcements", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const { title, description } = req.body;

            if (!title || !description) {
                return res.status(400).json({ error: true, message: "Title and description are required" });
            }

            const result = await announcementCollection.insertOne({
                title,
                description,
                createdAt: new Date(),
                author: req.firebaseUser.email,
            });

            res.status(201).json({ insertedId: result.insertedId });
        });



        // remove member or update user
        app.patch('/users/remove-member/:id', verifyAdmin, async (req, res) => {
            const userId = req.params.id;
            const result = await usersCollection.updateOne(
                { _id: new ObjectId(userId) },
                { $set: { role: 'user' } }
            );
            res.send(result);
        });

        // Accept agreement 
        app.patch("/agreements/accept/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const agreement = await agreementCollection.findOne({ _id: new ObjectId(id) });

            // Update status to checked
            await agreementCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: "checked" } });

            // Update user's role to member
            await usersCollection.updateOne({ email: agreement.userEmail }, { $set: { role: "member" } });

            res.send({ success: true });
        });























        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('Building Management Server is running ✅');
});


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
})