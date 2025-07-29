require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY)
const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 5000;


// Middleware
app.use(cors());
app.use(express.json());



const decodedServiceKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decodedServiceKey);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

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
        // await client.connect();


        const db = client.db('unitSphereDB');
        const apartmentsCollection = db.collection('apartments');
        const agreementCollection = db.collection('agreement')
        const usersCollection = db.collection('users')
        const announcementCollection = db.collection('announcements');
        const couponCollection = db.collection('coupons');
        const paymentsCollection = db.collection('payments');


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

        const verifyAdminOrMember = async (req, res, next) => {
            const user = await usersCollection.findOne({
                email: req.firebaseUser.email,
            });

            if (user.role === "admin" || user.role === "member") {
                next();
            } else {
                res.status(403).json({ message: "Forbidden: Admin or Member only." });
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
            async (req, res) => {
                const users = await usersCollection
                    .find({ email: { $ne: req.firebaseUser.email } })
                    .toArray();
                res.send(users);
            }
        )

        // GET: Get a single user by email
        app.get("/users/me", verifyFirebaseToken, async (req, res) => {
            const email = req.firebaseUser.email;
            const user = await usersCollection.findOne({ email });
            res.send(user);
        });


        // GET: pending requests 

        app.get("/agreements/pending", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const requests = await agreementCollection.find({ status: "pending" }).toArray();
            res.send(requests);
        });


        //  Admin: Get all coupons (including unavailable)
        app.get("/coupons", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const coupons = await couponCollection.find().toArray();
            res.send(coupons);
        });

        //  Public: Get only available coupons
        app.get("/coupons/available", async (req, res) => {
            const coupons = await couponCollection.find({ available: true }).toArray();
            res.send(coupons);
        });

        // GET:announcements 
        app.get('/announcements', verifyFirebaseToken, async (req, res) => {
            const announcements = await announcementCollection.find({}).toArray();
            res.send(announcements);
        });


        // GET:profile details 
        app.get('/agreements/my', verifyFirebaseToken, verifyAdminOrMember, async (req, res) => {
            const userEmail = req.query.email || req.firebaseUser.email;
            const agreement = await agreementCollection.findOne({ userEmail, status: 'checked' });

            const profileData = {
                fullName: agreement.userName,
                emailAddress: agreement.userEmail,
                profilePicture: agreement.photo,
                membershipStartDate: agreement.acceptDate,
                floorNumber: agreement.floorNo,
                blockName: agreement.blockName,
                apartmentNumber: agreement.apartmentNo,
                monthlyRent: agreement.rent,
            };

            res.send(profileData);
        });

        // Get: payment history 
        app.get('/payments', verifyFirebaseToken, verifyAdminOrMember, async (req, res) => {
            const email = req.firebaseUser.email;

            const payments = await paymentsCollection
                .find({ userEmail: email })
                .sort({ paymentDate: -1 })
                .toArray();

            res.send(payments);
        });

        // GET /rooms/stats
        app.get('/rooms/stats', async (req, res) => {
            const total = await apartmentsCollection.countDocuments();
            const available = await apartmentsCollection.countDocuments({ availability: 'available' });
            const unavailable = await apartmentsCollection.countDocuments({ availability: { $ne: 'available' } });
            res.send({ total, available, unavailable });
        });

        // GET /users/count
        app.get('/users/count', async (req, res) => {
            const count = await usersCollection.countDocuments({ role: 'user' });
            res.send({ count });
        });

        // GET /members/count
        app.get('/members/count', async (req, res) => {
            const count = await usersCollection.countDocuments({ role: 'member' });
            res.send({ count });
        });



        // POST ---------------------------------------POST------------------------------------------------POST//

        app.post('/create-payment-intent', verifyFirebaseToken, async (req, res) => {

            const rentInCents = req.body.rentInCents
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: rentInCents,
                    currency: 'usd',
                    payment_method_types: ['card']
                })
                res.json({ clientSecret: paymentIntent.client_secret })
            } catch (error) {
                res.status(500).json({ error: error.message })
            }
        })


        // post agreement 
        app.post('/agreements', verifyFirebaseToken, async (req, res) => {
            const agreement = req.body;
            const { userEmail } = agreement;

            const existing = await agreementCollection.findOne({ userEmail });

            if (existing) {
                return res.status(400).send({ error: true, message: "You have already applied for an apartment." });
            }

            const result = await agreementCollection.insertOne(agreement);
            res.send({ insertedId: result.insertedId });
        });


        // POST: user 
        app.post("/add-user", async (req, res) => {
            const userData = req.body;

            // console.log(userData);

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
            const result = await announcementCollection.insertOne({
                title,
                description,
                createdAt: new Date(),
                author: req.firebaseUser.email,
            });

            res.status(201).json({ insertedId: result.insertedId });
        });

        // POST: coupons 
        app.post("/coupons", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const coupon = req.body;
            coupon.createdAt = new Date();
            const result = await couponCollection.insertOne(coupon);
            res.send(result);
        });

        app.post('/validate-coupon', verifyAdminOrMember, async (req, res) => {
            const { code, originalAmount } = req.body;

            if (!code || !originalAmount) {
                return res.status(200).send({ valid: false, message: 'Missing coupon code or amount.' });
            }

            const coupon = await couponCollection.findOne({ code: code.toUpperCase(), available: true });

            if (!coupon) {
                return res.status(200).send({ valid: false, message: 'Invalid or unavailable coupon.' });
            }

            const now = new Date();
            if (coupon.expiresAt && new Date(coupon.expiresAt) < now) {
                return res.status(200).send({ valid: false, message: 'Coupon expired.' });
            }

            const discountPercent = coupon.discount;
            const discountAmount = (originalAmount * discountPercent) / 100;
            const finalAmount = originalAmount - discountAmount;

            return res.status(200).send({
                valid: true,
                discountPercent,
                discountAmount,
                finalAmount,
                couponId: coupon._id
            });
        });

        // payments
        app.post('/payments', verifyFirebaseToken, verifyAdminOrMember, async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            res.send(result);
        });



        //POST: remove member or update user
        app.patch('/users/remove-member/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const userId = req.params.id;
            const result = await usersCollection.updateOne(
                { _id: new ObjectId(userId) },
                { $set: { role: 'user' } }
            );
            res.send(result);
        });



        app.patch("/agreements/accept/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const agreement = await agreementCollection.findOne({ _id: new ObjectId(id) });

            // Update  status to 'checked' and save accept date
            const acceptDate = new Date();
            await agreementCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        status: "checked",
                        acceptDate: acceptDate
                    }
                }
            );

            // update user role to member 
            await usersCollection.updateOne(
                { email: agreement.userEmail },
                { $set: { role: "member" } }
            );

            //  Mark  as booked 
            await apartmentsCollection.updateOne(
                { _id: new ObjectId(agreement.agreementId) },
                { $set: { availability: "booked" } }
            );
            res.send({ success: true });
        });



        //  PATCH: Reject agreement request  
        app.patch("/agreements/reject/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const query = { _id: new ObjectId(id) };
            const updateDoc = { $set: { status: "checked" } };

            const result = await agreementCollection.updateOne(query, updateDoc);

            res.send(result);

        });

        app.patch("/coupons/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { available } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { available: available },
            };

            const result = await couponCollection.updateOne(filter, updateDoc);
            res.send(result);
        });


        // DELETE: coupons
        app.delete("/coupons/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const result = await couponCollection.deleteOne(query);
            res.send(result)
        });














        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('Building Management Server is running ');
});


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
})