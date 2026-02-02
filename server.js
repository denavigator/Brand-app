require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
const Order = require('./models/order');

const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// Ensure folders exist
if(!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads');
if(!fs.existsSync('public/templates')) fs.mkdirSync('public/templates');

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('MongoDB connected'))
  .catch(err => console.error(err));

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Routes
app.get('/', (req,res) => res.render('index'));
app.get('/how', (req,res) => res.render('how'));
app.get('/packages', (req,res) => res.render('packages'));
app.get('/order', (req,res) => res.render('order', { selectedPackage: req.query.package || 'starter' }));
app.get('/about', (req,res) => res.render('about'));

// Checkout
app.post('/checkout', upload.single('logo'), async (req,res)=>{
  const { name, email, product, packageType } = req.body;
  let amount = 5000; if(packageType==='pro') amount=10000; if(packageType==='premium') amount=20000;

  const order = new Order({ name, email, product, packageType, logoPath: req.file?req.file.filename:null });

  if(req.file){
    const templates = fs.readdirSync('public/templates/');
    if(templates.length>0){
      const template = templates[Math.floor(Math.random()*templates.length)];
      const mockupName = 'mockup-' + Date.now() + '.png';
      try{
        await sharp(`public/templates/${template}`)
          .composite([{ input:`public/uploads/${req.file.filename}`, gravity:'center' }])
          .toFile(`public/uploads/${mockupName}`);
        order.mockupPath = mockupName;
      }catch(err){ console.error('Mockup generation failed', err);}
    }
  }

  await order.save();

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types:['card'],
      customer_email: email,
      line_items:[{
        price_data:{
          currency:'usd',
          product_data:{ name:`${packageType} branding package` },
          unit_amount: amount
        },
        quantity:1
      }],
      mode:'payment',
      success_url:`${req.protocol}://${req.get('host')}/confirmation?status=success&orderId=${order._id}`,
      cancel_url:`${req.protocol}://${req.get('host')}/order`
    });
    res.redirect(session.url);
  } catch(err){ console.error(err); res.send('Stripe session error'); }
});

// Confirmation
app.get('/confirmation', async (req,res)=>{
  const { status, orderId } = req.query;
  const order = orderId? await Order.findById(orderId): null;
  res.render('confirmation',{status, order});
});

// Admin
app.get('/admin', async (req,res)=>{
  const orders = await Order.find().sort({createdAt:-1});
  res.render('admin',{orders});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`Server running on ${PORT}`));
